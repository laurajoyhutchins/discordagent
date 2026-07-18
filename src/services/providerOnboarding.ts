import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type Message,
  type TextChannel,
} from 'discord.js';
import { AGENT_PROVIDER_IDS, isAgentProviderId, type AgentProviderId } from '../agents/contracts.js';
import { providerLabel } from '../agents/providerLabels.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import type { SettingsService } from './settingsService.js';
import { redactErrorMessage } from '../utils/redaction.js';
import type { PrimaryProviderActivationResult } from './agentRuntimeService.js';

const SETUP_MESSAGE_KEY = 'provider_setup_message_id';
const SETUP_BUTTON_PREFIX = 'provider_setup:';

export interface ProviderOnboardingService {
  ensurePrompt(options?: { forceSelection?: boolean }): Promise<void>;
  handleButton(interaction: ButtonInteraction): Promise<boolean>;
}

export function createProviderOnboardingService(input: {
  ownerId: string;
  settings: Pick<SettingsService, 'global' | 'updateGlobalWithActivation'>;
  metadata: Pick<SettingsRepository, 'get' | 'set'>;
  providers: ProviderRegistry;
  channel: TextChannel;
  botUserId: string;
  onSelected?: (provider: AgentProviderId) => Promise<PrimaryProviderActivationResult | void>;
  captureSelectionState?: () => () => void;
}): ProviderOnboardingService {
  let reconciliation = Promise.resolve();

  async function reconcilePrompt(options: { forceSelection?: boolean } = {}): Promise<void> {
    if (!input.botUserId) throw new Error('Provider setup reconciliation requires the configured bot identity.');
    const selectedProvider = options.forceSelection ? undefined : input.settings.global().defaultProvider;
    const providers = input.providers.list();
    const components = !selectedProvider && providers.length > 0
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...providers.map(provider => new ButtonBuilder()
            .setCustomId(`${SETUP_BUTTON_PREFIX}${provider}`)
            .setLabel(providerLabel(provider))
            .setStyle(ButtonStyle.Primary)),
        )]
      : [];
    const content = selectedProvider
      ? `Global provider set to **${providerLabel(selectedProvider)}**. The PM chat and new projects will use it by default.`
      : providers.length > 0
        ? 'Provider setup required: choose the provider for the PM chat and new projects. You can change project providers later.'
        : 'Provider setup required, but no provider is currently available. Install or configure Claude, Codex, or OpenCode on the bot host, then restart the bot.';
    const payload = { content, components };

    const existingId = input.metadata.get(SETUP_MESSAGE_KEY);
    if (existingId) {
      let existing: Message | null;
      try {
        existing = await input.channel.messages.fetch(existingId) as Message;
      } catch (error) {
        if (!isMessageNotFound(error)) throw error;
        existing = null;
      }
      const authoredByBot = existing?.author?.bot === true && existing.author?.id === input.botUserId;
      const exactChannel = existing && ('channelId' in existing ? existing.channelId === input.channel.id : false);
      if (existing && (!authoredByBot || !exactChannel)) {
        throw new Error('Persisted provider setup message failed bot/channel identity validation; refusing to edit it.');
      }
      const validProviderButtonIds = new Set(AGENT_PROVIDER_IDS.map(provider => `${SETUP_BUTTON_PREFIX}${provider}`));
      const hasForeignComponents = (existing?.components ?? []).some(row => {
        if (!('components' in row) || !Array.isArray(row.components)) return false;
        return row.components.some((component: { customId?: string | null }) => {
          const customId = component.customId;
          return typeof customId === 'string' && !validProviderButtonIds.has(customId);
        });
      });
      const hasInvalidProviderButtonSchema = !hasExpectedProviderButtonSchema(existing?.components ?? []);
      if (existing && (hasForeignComponents || hasInvalidProviderButtonSchema)) {
        throw new Error('Persisted provider setup message has unexpected controls; refusing to edit it.');
      }
      if (existing) {
        const existingComponents = 'components' in existing ? existing.components : undefined;
        const desiredComponents = components.map(component => component.toJSON());
        if (existing.content === content && JSON.stringify(existingComponents ?? []) === JSON.stringify(desiredComponents)) return;
        await existing.edit(payload);
        return;
      }
    }
    if (selectedProvider && !existingId) return;
    const message = await input.channel.send(payload);
    input.metadata.set(SETUP_MESSAGE_KEY, message.id);
  }

  function ensurePrompt(options: { forceSelection?: boolean } = {}): Promise<void> {
    const next = reconciliation.then(() => reconcilePrompt(options));
    reconciliation = next.catch(() => undefined);
    return next;
  }

  async function handleButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith(SETUP_BUTTON_PREFIX)) return false;
    const persistedMessageId = input.metadata.get(SETUP_MESSAGE_KEY);
    if (interaction.user.id !== input.ownerId || interaction.channelId !== input.channel.id
      || ('message' in interaction && interaction.message?.channelId !== input.channel.id)
      || ('message' in interaction && interaction.message?.id !== persistedMessageId)
      || ('message' in interaction && (interaction.message?.author?.bot !== true || interaction.message.author.id !== input.botUserId))) {
      await interaction.reply({ content: 'Only the configured owner may choose the global provider.', ephemeral: true });
      return true;
    }
    if ('message' in interaction && (!interaction.message?.components?.length || !hasExpectedProviderButtonSchema(interaction.message.components))) {
      await interaction.reply({ content: 'That setup message has unexpected controls and cannot be used.', ephemeral: true });
      return true;
    }

    const providerValue = interaction.customId.slice(SETUP_BUTTON_PREFIX.length);
    if (!isAgentProviderId(providerValue)) {
      await interaction.reply({ content: 'That provider selection is invalid.', ephemeral: true });
      return true;
    }
    const provider = providerValue;
    if (!input.providers.list().includes(provider)) {
      await interaction.reply({ content: 'That provider is no longer available. Restart the bot and choose an available provider.', ephemeral: true });
      return true;
    }

    let availability: Awaited<ReturnType<ProviderRegistry['availability']>>;
    try {
      availability = await input.providers.availability(provider);
    } catch (error) {
      console.error(`[providerOnboarding] Availability check failed for ${provider}:`, redactErrorMessage(error));
      await interaction.reply({ content: `${providerLabel(provider)} is unavailable on the bot host. Try again later or contact the bot owner.`, ephemeral: true });
      return true;
    }
    if (!availability.available) {
      await interaction.reply({
        content: availability.authenticationRequired
          ? provider === 'codex'
            ? 'Codex sign-in required. Run /codex-auth login, complete the device flow, then select this button again.'
            : `${providerLabel(provider)} sign-in required. Complete the provider sign-in, then select this button again.`
          : `${providerLabel(provider)} is unavailable on the bot host. Try again later or contact the bot owner.`,
        ephemeral: true,
      });
      return true;
    }

    try {
      await input.settings.updateGlobalWithActivation({ defaultProvider: provider }, async () => {
        await input.onSelected?.(provider);
      }, input.captureSelectionState?.());
    } catch (error) {
      console.error('[providerOnboarding] Provider activation failed:', redactErrorMessage(error));
      await interaction.reply({
        content: `The ${providerLabel(provider)} provider could not be activated. Try again later or contact the bot owner.`,
        ephemeral: true,
      });
      return true;
    }

    // Persistence and PM activation have succeeded. Reconcile the durable setup
    // message before acknowledging the component so a failed interaction update
    // cannot leave stale controls as the only visible state.
    try {
      await ensurePrompt();
      try {
        await interaction.update({
          content: `Global provider set to **${providerLabel(provider)}**. The PM chat and new projects will use it by default.`,
          components: [],
        });
      } catch (error) {
        await ensurePrompt().catch((reconcileError: unknown) => {
          console.warn('[providerOnboarding] Failed to reconcile setup message after interaction update failure:', redactErrorMessage(reconcileError));
        });
        throw error;
      }
    } catch (error) {
      console.error('[providerOnboarding] Provider setup acknowledgement failed:', redactErrorMessage(error));
      await Promise.resolve(interaction.reply({
        content: 'The provider selection could not be completed. Try again later or contact the bot owner.',
        ephemeral: true,
      })).catch(() => undefined);
      return true;
    }
    return true;
  }

  return { ensurePrompt, handleButton };
}

function isMessageNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && (error as { code?: unknown }).code === 10008;
}

function hasExpectedProviderButtonSchema(components: readonly unknown[]): boolean {
  if (components.length === 0) return true;
  if (components.length !== 1) return false;
  const row = components[0];
  const validProviderButtonIds = new Set(AGENT_PROVIDER_IDS.map(provider => `${SETUP_BUTTON_PREFIX}${provider}`));
  if (!row || typeof row !== 'object' || !('components' in row) || !Array.isArray(row.components) || row.components.length === 0) return false;
  const seen = new Set<string>();
  return row.components.every((component: { customId?: string | null; type?: number; style?: number; label?: string | null }) => {
    const customId = component.customId;
    if (typeof customId !== 'string' || !validProviderButtonIds.has(customId) || seen.has(customId)) return false;
    seen.add(customId);
    const provider = customId.slice(SETUP_BUTTON_PREFIX.length) as AgentProviderId;
    return component.type === 2 && component.style === ButtonStyle.Primary && component.label === providerLabel(provider);
  });
}

export { SETUP_BUTTON_PREFIX };
