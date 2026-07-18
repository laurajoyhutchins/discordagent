import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import { getCodexAuthService, maybeGetPendingTaskService } from '../services/agentRuntimeService.js';
import type { PendingTaskService } from '../services/pendingTaskService.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { panelIdentityRegistry, type PanelIdentityKey, type PanelIdentityRegistry } from '../discord/panelIdentity.js';

export interface CodexAuthDependencies {
  auth: CodexAuthService;
  authorizedUserId: string;
  pendingTasks?: PendingTaskService;
  panelIdentity?: PanelIdentityRegistry;
}
function defaults(): CodexAuthDependencies {
  return { auth: getCodexAuthService(), authorizedUserId: process.env.AUTHORIZED_USER_ID ?? process.env.NOTIFY_USER_ID ?? '', pendingTasks: maybeGetPendingTaskService(), panelIdentity: panelIdentityRegistry };
}
function owner(userId: string, deps: CodexAuthDependencies): boolean {
  return Boolean(deps.authorizedUserId) && userId === deps.authorizedUserId;
}

function authPanelKey(interaction: { user: { id: string }; channelId: string }): PanelIdentityKey {
  return { kind: 'codex-auth', userId: interaction.user.id, channelId: interaction.channelId };
}

function registerPanelReply(
  dependencies: CodexAuthDependencies,
  key: PanelIdentityKey,
  result: unknown,
  components: readonly unknown[],
): void {
  (dependencies.panelIdentity ?? panelIdentityRegistry).register(key, result as { id?: unknown; channelId?: unknown; author?: { id?: unknown; bot?: unknown } | null }, components);
}

export async function handleCodexAuth(interaction: ChatInputCommandInteraction, injected?: CodexAuthDependencies): Promise<void> {
  let deps: CodexAuthDependencies;
  try { deps = injected ?? defaults(); } catch (error) {
    console.error('[codex-auth] Unable to initialize authentication service:', redactErrorMessage(error));
    await interaction.reply({ content: 'Codex authentication is temporarily unavailable. Try again later.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!owner(interaction.user.id, deps)) {
    await interaction.reply({ content: 'Only the configured owner may manage Codex authentication.', flags: MessageFlags.Ephemeral });
    return;
  }
  const action = interaction.options.getSubcommand();
  try {
    if (action === 'status') {
      const state = await deps.auth.readAccount();
      await interaction.reply({ content: state.authenticated
        ? `✅ Codex is authenticated${state.planType ? ` (${state.planType})` : ''}.`
        : '🔐 Codex authentication is required. Use `/codex-auth login`.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'login') {
      const state = await deps.auth.readAccount();
      if (state.authenticated) {
        await interaction.reply({ content: '✅ Codex is already authenticated.', flags: MessageFlags.Ephemeral });
        return;
      }
      await deps.auth.startDeviceLogin();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('codex_auth_check').setLabel('Check again').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('codex_auth_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      const payload = {
        content: ['🔐 **Codex sign-in**', 'Complete the device sign-in locally on the bot host using the Codex authentication flow.', 'Return here and select **Check again** after the local browser flow completes.', 'The verification URL and one-time code are intentionally never sent to Discord.'].join('\n'),
        components: [row], flags: MessageFlags.Ephemeral as const, fetchReply: true as const,
      };
      const result = await interaction.reply(payload);
      registerPanelReply(deps, authPanelKey(interaction), result, payload.components);
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('codex_auth_logout_confirm').setLabel('Confirm logout').setStyle(ButtonStyle.Danger),
    );
    const payload = { content: 'Log out the local Codex account?', components: [row], flags: MessageFlags.Ephemeral as const, fetchReply: true as const };
    const result = await interaction.reply(payload);
    registerPanelReply(deps, authPanelKey(interaction), result, payload.components);
  } catch (error) {
    console.error('[codex-auth] Authentication command failed:', redactErrorMessage(error));
    await Promise.resolve(interaction.reply({
      content: 'Codex authentication could not be completed. Try again later or contact the bot owner.',
      flags: MessageFlags.Ephemeral,
    })).catch(() => undefined);
  }
}

export async function handleCodexAuthButton(interaction: ButtonInteraction, injected?: CodexAuthDependencies): Promise<boolean> {
  if (!interaction.customId.startsWith('codex_auth_')) return false;
  let deps: CodexAuthDependencies;
  try { deps = injected ?? defaults(); } catch (error) {
    console.error('[codex-auth] Unable to initialize authentication service:', redactErrorMessage(error));
    await interaction.reply({ content: 'Codex authentication is temporarily unavailable. Try again later.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!owner(interaction.user.id, deps)) {
    await interaction.reply({ content: 'Only the configured owner may manage Codex authentication.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const panelIdentity = deps.panelIdentity ?? panelIdentityRegistry;
  const panelKey = authPanelKey(interaction);
  if (!panelIdentity.matches(panelKey, interaction.message)) {
    await interaction.reply({ content: 'This Codex authentication panel is stale or has unexpected controls. Run `/codex-auth login` again.', flags: MessageFlags.Ephemeral });
    return true;
  }
  try {
  if (interaction.customId === 'codex_auth_check') {
    const state = await deps.auth.readAccount();
    const pendingRecord = deps.pendingTasks?.get(interaction.user.id);
    const pending = Boolean(pendingRecord);
    const components = state.authenticated && pending
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('codex_auth_start_pending').setLabel('Start task').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('codex_auth_discard_pending').setLabel('Discard').setStyle(ButtonStyle.Secondary),
        )]
      : state.authenticated ? [] : interaction.message.components;
    await interaction.update({ content: state.authenticated
      ? pending
        ? '✅ Codex authentication verified. A pending task is ready to start.'
        : '✅ Codex authentication verified. No pending task is waiting.'
      : 'Codex is not authenticated yet. Complete the browser flow, then select **Check again**.', components });
    if (state.authenticated && !pending) panelIdentity.clear(panelKey);
    else registerPanelReply(deps, panelKey, interaction.message, components);
  } else if (interaction.customId === 'codex_auth_start_pending') {
    const state = await deps.auth.readAccount();
    if (!state.authenticated) {
      await interaction.update({ content: 'Codex authentication is no longer valid. Run `/codex-auth login` again.', components: [] });
      panelIdentity.clear(panelKey);
      return true;
    }
    await interaction.update({ content: 'Starting the pending Codex task…', components: [] });
    try {
      await deps.pendingTasks?.start(interaction.user.id);
      await interaction.followUp({ content: '✅ Pending Codex task started in its project thread.', flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('[codex-auth] Pending task start failed:', redactErrorMessage(error));
      await interaction.followUp({ content: 'The pending task could not be started. Try again later or contact the bot owner.', flags: MessageFlags.Ephemeral });
    }
  } else if (interaction.customId === 'codex_auth_discard_pending') {
    deps.pendingTasks?.discard(interaction.user.id);
    await interaction.update({ content: 'Pending Codex task discarded. No thread or worktree was created.', components: [] });
    panelIdentity.clear(panelKey);
  } else if (interaction.customId === 'codex_auth_cancel') {
    await deps.auth.cancelLogin();
    await interaction.update({ content: 'Codex sign-in cancelled. No task was started.', components: [] });
    panelIdentity.clear(panelKey);
  } else if (interaction.customId === 'codex_auth_logout_confirm') {
    await deps.auth.logout();
    await interaction.update({ content: 'Codex has been logged out on the bot host.', components: [] });
    panelIdentity.clear(panelKey);
  }
  } catch (error) {
    console.error('[codex-auth] Authentication action failed:', redactErrorMessage(error));
    const response = interaction.replied || interaction.deferred
      ? interaction.followUp({ content: 'Codex authentication could not be completed. Try again later or contact the bot owner.', flags: MessageFlags.Ephemeral })
      : interaction.reply({ content: 'Codex authentication could not be completed. Try again later or contact the bot owner.', flags: MessageFlags.Ephemeral });
    await Promise.resolve(response).catch(() => undefined);
  }
  return true;
}
