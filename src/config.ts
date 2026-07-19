import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { HostMcpServers } from './agents/contracts.js';
import { resolveApplicationPaths } from './utils/applicationPaths.js';

const applicationPaths = resolveApplicationPaths();
if (applicationPaths.notice) console.warn(`[config] ${applicationPaths.notice}`);

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

/**
 * Load MCP server configs from the user's ~/.claude/settings.json.
 * Returns the mcpServers record if found, typed for the Agent SDK.
 */
function loadUserMcpServers(): HostMcpServers | undefined {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    if (settings.mcpServers && typeof settings.mcpServers === 'object') {
      const count = Object.keys(settings.mcpServers).length;
      if (count > 0) {
        console.log(`[config] Loaded ${count} MCP server(s) from ~/.claude/settings.json: ${Object.keys(settings.mcpServers).join(', ')}`);
        return settings.mcpServers as HostMcpServers;
      }
    }
  } catch {
    // No settings file or invalid JSON — that's fine
  }
  return undefined;
}

export function isTerminalReplEnabled(): boolean {
  if (process.env.TERMINAL_REPL_ENABLED === 'false') return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  guildId: required('DISCORD_GUILD_ID'),
  authorizedRoleIds: required('AUTHORIZED_ROLE_IDS').split(',').map(s => s.trim()),
  notifyUserId: process.env.NOTIFY_USER_ID ?? '',
  claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS ?? '900000', 10),
  roborevCliPath: process.env.ROBOREV_CLI_PATH ?? 'roborev',
  projectsBaseDir: process.env.PROJECTS_BASE_DIR ?? '',
  allowNonGit: process.env.ALLOW_NON_GIT === 'true',
  mcpServers: loadUserMcpServers(),
  usageChannelId: process.env.USAGE_CHANNEL_ID ?? '',
  defaultModel: process.env.CLAUDE_MODEL ?? '',
  claudeEnabled: process.env.CLAUDE_ENABLED !== 'false',
  defaultCodexModel: process.env.CODEX_MODEL ?? '',
  codexCliPath: process.env.CODEX_CLI_PATH ?? 'codex',
  codexEnabled: process.env.CODEX_ENABLED !== 'false',
  openCodeCliPath: process.env.OPENCODE_CLI_PATH ?? 'opencode',
  openCodeEnabled: process.env.OPENCODE_ENABLED !== 'false',
  openCodeTimeoutMs: parseInt(process.env.OPENCODE_TIMEOUT_MS ?? '900000', 10),
  defaultOpenCodeModel: process.env.OPENCODE_MODEL ?? '',
  openCodePrimaryModel: process.env.OPENCODE_PRIMARY_MODEL ?? '',
  authorizedUserId: process.env.AUTHORIZED_USER_ID ?? process.env.NOTIFY_USER_ID ?? '',
  primaryAgentModel: process.env.PRIMARY_AGENT_MODEL ?? '',
  primaryUsageReserve: parseFloat(process.env.PRIMARY_USAGE_RESERVE ?? '10'),
  databasePath: applicationPaths.databasePath,
  legacyProjectsPath: applicationPaths.legacyProjectsPath,
  worktreesBaseDir: applicationPaths.worktreesBaseDir,
} as const;
