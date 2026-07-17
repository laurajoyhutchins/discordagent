import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { CodexAuthService } from '../agents/codex/codexAuthService.js';
import { getCodexAuthService, maybeGetPendingTaskService } from '../services/agentRuntimeService.js';
import type { PendingTaskService } from '../services/pendingTaskService.js';
import { redactErrorMessage } from '../utils/redaction.js';

export interface CodexAuthDependencies {
  auth: CodexAuthService;
  authorizedUserId: string;
  pendingTasks?: PendingTaskService;
}
function defaults(): CodexAuthDependencies {
  return { auth: getCodexAuthService(), authorizedUserId: process.env.AUTHORIZED_USER_ID ?? process.env.NOTIFY_USER_ID ?? '', pendingTasks: maybeGetPendingTaskService() };
}
function owner(userId: string, deps: CodexAuthDependencies): boolean {
  return Boolean(deps.authorizedUserId) && userId === deps.authorizedUserId;
}

export async function handleCodexAuth(interaction: ChatInputCommandInteraction, injected?: CodexAuthDependencies): Promise<void> {
  const deps = injected ?? defaults();
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
      const login = await deps.auth.startDeviceLogin();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('codex_auth_check').setLabel('Check again').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('codex_auth_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        content: [`🔐 **Codex sign-in**`, `Open: ${login.verificationUrl}`, `Enter one-time code: \`${login.userCode}\``, '', 'Return here and select **Check again**. Do not paste credentials into Discord.'].join('\n'),
        components: [row], flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('codex_auth_logout_confirm').setLabel('Confirm logout').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ content: 'Log out the local Codex account?', components: [row], flags: MessageFlags.Ephemeral });
  } catch (error) {
    await interaction.reply({
      content: `Unable to manage Codex authentication: ${redactErrorMessage(error)}\nOn the bot host, run \`codex login --device-auth\`, then use \`/codex-auth status\`.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => undefined);
  }
}

export async function handleCodexAuthButton(interaction: ButtonInteraction, injected?: CodexAuthDependencies): Promise<boolean> {
  if (!interaction.customId.startsWith('codex_auth_')) return false;
  const deps = injected ?? defaults();
  if (!owner(interaction.user.id, deps)) {
    await interaction.reply({ content: 'Only the configured owner may manage Codex authentication.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.customId === 'codex_auth_check') {
    const state = await deps.auth.readAccount();
    const pending = deps.pendingTasks?.get(interaction.user.id);
    const components = state.authenticated && pending
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('codex_auth_start_pending').setLabel('Start task').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('codex_auth_discard_pending').setLabel('Discard').setStyle(ButtonStyle.Secondary),
        )]
      : state.authenticated ? [] : interaction.message.components;
    await interaction.update({ content: state.authenticated
      ? pending
        ? `✅ Codex authentication verified. Pending task: **${pending.projectName}** — ${pending.prompt.slice(0, 160)}`
        : '✅ Codex authentication verified. No pending task is waiting.'
      : 'Codex is not authenticated yet. Complete the browser flow, then select **Check again**.', components });
  } else if (interaction.customId === 'codex_auth_start_pending') {
    const state = await deps.auth.readAccount();
    if (!state.authenticated) {
      await interaction.update({ content: 'Codex authentication is no longer valid. Run `/codex-auth login` again.', components: [] });
      return true;
    }
    await interaction.update({ content: 'Starting the pending Codex task…', components: [] });
    try {
      await deps.pendingTasks?.start(interaction.user.id);
      await interaction.followUp({ content: '✅ Pending Codex task started in its project thread.', flags: MessageFlags.Ephemeral });
    } catch (error) {
      await interaction.followUp({ content: `Unable to start the pending task: ${redactErrorMessage(error)}`, flags: MessageFlags.Ephemeral });
    }
  } else if (interaction.customId === 'codex_auth_discard_pending') {
    deps.pendingTasks?.discard(interaction.user.id);
    await interaction.update({ content: 'Pending Codex task discarded. No thread or worktree was created.', components: [] });
  } else if (interaction.customId === 'codex_auth_cancel') {
    await deps.auth.cancelLogin();
    await interaction.update({ content: 'Codex sign-in cancelled. No task was started.', components: [] });
  } else if (interaction.customId === 'codex_auth_logout_confirm') {
    await deps.auth.logout();
    await interaction.update({ content: 'Codex has been logged out on the bot host.', components: [] });
  }
  return true;
}
