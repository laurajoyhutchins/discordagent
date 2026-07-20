import type { AgentProvider, HostMcpServerConfig, HostMcpServers } from '../agents/contracts.js';
import { ClaudeProvider } from '../agents/claude/claudeProvider.js';
import { AppServerTransport } from '../agents/codex/appServerTransport.js';
import { CodexAuthService } from '../agents/codex/codexAuthService.js';
import { CodexProvider } from '../agents/codex/codexProvider.js';
import { OpenCodeAcpTransport } from '../agents/opencode/acpTransport.js';
import { OpenCodeProvider } from '../agents/opencode/opencodeProvider.js';
import { ProviderRegistry } from '../agents/providerRegistry.js';
import { config } from '../config.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { captureRateLimitEvent, captureSessionResult } from './usageTracker.js';
import type { UsageAdmissionService } from './usageAdmission.js';
import { RuntimeLifecycle } from './runtimeLifecycle.js';

export interface HostMcpProfiles {
  profiles: readonly string[];
  resolve(profile?: string): HostMcpServers | undefined;
}

export function createHostMcpProfiles(
  configuredServers?: HostMcpServers,
): HostMcpProfiles {
  const servers = configuredServers ?? {};
  const serverNames = Object.keys(servers).filter(name => name !== 'default' && name !== 'disabled');
  const filteredServers = Object.fromEntries(serverNames.map(name => [name, servers[name]])) as Record<string, HostMcpServerConfig>;
  const defaultServers = serverNames.length > 0 ? filteredServers : undefined;
  const profiles = ['default', 'disabled', ...serverNames];

  return {
    profiles,
    resolve(profile?: string): HostMcpServers | undefined {
      if (profile === undefined || profile === 'default') return defaultServers;
      if (profile === 'disabled') return {};
      if (!Object.prototype.hasOwnProperty.call(servers, profile)) return undefined;
      return { [profile]: filteredServers[profile] };
    },
  };
}

export interface ProviderBootstrapOptions {
  usage: UsageAdmissionService;
  claudeProvider?: AgentProvider;
  codexProvider?: AgentProvider;
  openCodeProvider?: AgentProvider;
  codexTransport?: AppServerTransport;
  codexAuth?: CodexAuthService;
  disableClaude?: boolean;
  disableCodex?: boolean;
  disableOpenCode?: boolean;
}

export interface ProviderBootstrapResult {
  providers: ProviderRegistry;
  mcpProfiles: HostMcpProfiles;
  codexTransport?: AppServerTransport;
  codexAuth?: CodexAuthService;
  stop(): Promise<void>;
}

export async function bootstrapProviders(
  options: ProviderBootstrapOptions,
): Promise<ProviderBootstrapResult> {
  const lifecycle = new RuntimeLifecycle({
    onError: ({ owner, error }) => {
      console.warn(`[runtime] Failed to stop ${owner}:`, redactErrorMessage(error));
    },
  });
  const providers = new ProviderRegistry();
  const mcpProfiles = createHostMcpProfiles(config.mcpServers);
  let codexTransport = options.codexTransport;
  let codexAuth = options.codexAuth;
  let codexProvider = options.codexProvider;
  let openCodeProvider = options.openCodeProvider;

  try {
    if (!options.disableClaude && config.claudeEnabled) {
      const claudeProvider = options.claudeProvider ?? new ClaudeProvider({
        resolveMcpServers: mcpProfiles.resolve,
        onRateLimit: info => {
          captureRateLimitEvent(info);
          const raw = typeof info.utilization === 'number' ? info.utilization : undefined;
          const utilization = raw === undefined ? undefined : raw <= 1 ? raw * 100 : raw;
          options.usage.recordWindow({
            provider: 'claude',
            windowType: typeof info.rateLimitType === 'string' ? info.rateLimitType : 'unknown',
            utilization,
            remaining: utilization === undefined ? undefined : Math.max(0, 100 - utilization),
            resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
            capturedAt: Date.now(),
            payload: info,
          });
        },
        onSessionResult: captureSessionResult,
      });
      if (claudeProvider.id !== 'claude') {
        throw new Error(`Runtime expected a Claude provider, received "${claudeProvider.id}"`);
      }
      try {
        const availability = await claudeProvider.checkAvailability();
        if (availability.available) providers.register(claudeProvider);
        else console.warn('[runtime] Claude unavailable:', redactErrorMessage(availability.reason ?? 'Claude provider is unavailable'));
      } catch (error) {
        console.warn('[runtime] Claude unavailable:', redactErrorMessage(error));
      }
    }

    if (!codexProvider && !options.disableCodex && config.codexEnabled) {
      try {
        codexTransport ??= new AppServerTransport({ command: config.codexCliPath });
        lifecycle.defer('Codex transport', () => codexTransport?.close());
        await codexTransport.initialize();
        codexAuth ??= new CodexAuthService(codexTransport);
        lifecycle.defer('Codex auth service', () => codexAuth?.close());
        codexProvider = new CodexProvider({ transport: codexTransport, auth: codexAuth });
        lifecycle.defer('Codex provider', () => (codexProvider as AgentProvider & { close?: () => Promise<void> }).close?.());
      } catch (error) {
        console.warn('[runtime] Codex App Server unavailable:', redactErrorMessage(error));
        await lifecycle.stop();
        codexTransport = undefined;
        codexAuth = undefined;
        codexProvider = undefined;
      }
    } else {
      if (codexTransport) lifecycle.defer('Codex transport', () => codexTransport?.close());
      if (codexAuth) lifecycle.defer('Codex auth service', () => codexAuth?.close());
      if (codexProvider) {
        lifecycle.defer('Codex provider', () => (codexProvider as AgentProvider & { close?: () => Promise<void> }).close?.());
      }
    }
    if (codexProvider) {
      if (codexProvider.id !== 'codex') {
        throw new Error(`Runtime expected a Codex provider, received "${codexProvider.id}"`);
      }
      providers.register(codexProvider);
    }

    if (openCodeProvider && openCodeProvider.id !== 'opencode') {
      throw new Error(`Runtime expected an OpenCode provider, received "${openCodeProvider.id}"`);
    }
    if (!options.disableOpenCode) {
      if (!openCodeProvider && config.openCodeEnabled) {
        openCodeProvider = new OpenCodeProvider({
          cliPath: config.openCodeCliPath,
          timeoutMs: config.openCodeTimeoutMs,
          defaultModel: config.defaultOpenCodeModel || undefined,
          createConnection: handlers => Promise.resolve(new OpenCodeAcpTransport({
            cliPath: config.openCodeCliPath,
            handlers,
          })),
        });
      }
      if (openCodeProvider) {
        try {
          const availability = await openCodeProvider.checkAvailability();
          if (availability.available) providers.register(openCodeProvider);
          else console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(availability.reason ?? 'OpenCode ACP is unavailable'));
        } catch (error) {
          console.warn('[runtime] OpenCode ACP unavailable:', redactErrorMessage(error));
        }
      }
    }

    return {
      providers,
      mcpProfiles,
      ...(codexTransport ? { codexTransport } : {}),
      ...(codexAuth ? { codexAuth } : {}),
      stop: () => lifecycle.stop(),
    };
  } catch (error) {
    await lifecycle.stop();
    throw error;
  }
}
