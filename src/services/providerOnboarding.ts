import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type TextChannel,
} from 'discord.js';
import type { AgentProviderId } from '../agents/contracts.js';
import type { ProviderRegistry } from '../agents/providerRegistry.js';
import type { SettingsRepository } from '../repositories/settingsRepository.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { providerLabel } from '../agents/providerLabels.js';

const SETUP_MESSAGE_KEY = 'provider_setup_message_id';
const SETUP_BUTTON_PREFIX = 'provider_setup:';

export interface ProviderOnboardingService {
  ensurePrompt(): Promise<void>;
  handleButton(interaction: ButtonInteraction): Promise<boolean>;
}

export function createProviderOnboardingService(input: {
  ownerId: string;
  settings: SettingsRepository;
  providers: ProviderRegistry;
  pmProviderIds?: readonly AgentProviderId[];
  channel: TextChannel;
  onSelected?: (provider: AgentProviderId) => Promise<void>;
}): ProviderOnboardingService {
  async function ensurePrompt(): Promise<void> {
    if (input.settings.getDefaultProvider()) return;

    const existingId = input.settings.get(SETUP_MESSAGE_KEY);
    if (existingId) {
      const existing = await input.channel.messages.fetch(existingId).catch(() => null);
      if (existing) return;
    }

    const providers = (input.pmProviderIds ?? input.providers.list().filter(provider => provider !== 'opencode'))
      .filter(provider => input.providers.list().includes(provider));
    const components = providers.length > 0
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...providers.map(provider => new ButtonBuilder()
            .setCustomId(`${SETUP_BUTTON_PREFIX}${provider}`)
            .setLabel(providerLabel(provider))
            .setStyle(ButtonStyle.Primary)),
        )]
      : [];
    const content = providers.length > 0
      ? 'Provider setup required: choose the provider for the PM chat and new projects. You can change project providers later.'
      : 'Provider setup required, but no provider is currently available. Install or configure Claude or Codex on the bot host, then restart the bot.';
    const message = await input.channel.send({ content, ...(components.length ? { components } : {}) });
    input.settings.set(SETUP_MESSAGE_KEY, message.id);
  }

  async function handleButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith(SETUP_BUTTON_PREFIX)) return false;
    if (interaction.user.id !== input.ownerId) {
      await interaction.reply({ content: 'Only the configured owner may choose the global provider.', ephemeral: true });
      return true;
    }

    const provider = interaction.customId.slice(SETUP_BUTTON_PREFIX.length) as AgentProviderId;
    if (!input.providers.list().includes(provider)) {
      await interaction.reply({ content: 'That provider is no longer available. Restart the bot and choose an available provider.', ephemeral: true });
      return true;
    }
    const pmProviders = input.pmProviderIds ?? input.providers.list().filter(candidate => candidate !== 'opencode');
    if (!pmProviders.includes(provider)) {
      await interaction.reply({ content: `${providerLabel(provider)} is available for project task channels only, not the PM chat.`, ephemeral: true });
      return true;
    }

    const availability = await input.providers.availability(provider);
    if (!availability.available) {
      await interaction.reply({
        content: availability.authenticationRequired
          ? provider === 'codex'
            ? 'Codex sign-in required. Run /codex-auth login, complete the device flow, then select this button again.'
            : `${providerLabel(provider)} sign-in required. Complete the provider sign-in, then select this button again.`
          : availability.reason ?? `${providerLabel(provider)} is unavailable on the bot host.`,
        ephemeral: true,
      });
      return true;
    }

    try {
      await input.onSelected?.(provider);
    } catch (error) {
      await interaction.reply({
        content: `The ${providerLabel(provider)} provider passed its availability check, but the PM chat could not be activated: ${redactErrorMessage(error)}`,
        ephemeral: true,
      });
      return true;
    }

    input.settings.setDefaultProvider(provider);
    await interaction.update({
      content: `Global provider set to **${providerLabel(provider)}**. The PM chat and new projects will use it by default.`,
      components: [],
    });
    return true;
  }

  return { ensurePrompt, handleButton };
}

export { SETUP_BUTTON_PREFIX };
