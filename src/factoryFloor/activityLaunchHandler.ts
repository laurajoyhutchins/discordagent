import { MessageFlags, type GuildMember } from 'discord.js';
import { isAuthorized } from '../utils/permissions.js';
import { redactErrorMessage } from '../utils/redaction.js';
import { getFactoryFloorRuntime } from './runtime.js';
import type { FactoryFloorActivityLaunchService } from './activityLaunchService.js';

interface ActivityLaunchChannel {
  isThread?: () => boolean;
  parentId?: string | null;
}

export interface FactoryFloorActivityLaunchInteraction {
  readonly id: string;
  readonly applicationId: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly channel?: ActivityLaunchChannel | null;
  readonly user: { readonly id: string };
  readonly guild?: {
    readonly members: {
      fetch(userId: string): Promise<GuildMember>;
    };
  } | null;
  readonly authorizingIntegrationOwners?: ReadonlyMap<number, string>;
  launchActivity(): Promise<unknown>;
  reply(options: { content: string; flags: MessageFlags }): Promise<unknown>;
}

export interface FactoryFloorActivityLaunchHandlerDependencies {
  readonly getLaunchService?: () => FactoryFloorActivityLaunchService | undefined;
  readonly authorize?: (member: GuildMember | null) => boolean;
  readonly logger?: (message: string) => void;
}

const GUILD_INSTALLATION_TYPE = 0;

async function replySafely(
  interaction: FactoryFloorActivityLaunchInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

export async function handleFactoryFloorActivityLaunch(
  interaction: FactoryFloorActivityLaunchInteraction,
  dependencies: FactoryFloorActivityLaunchHandlerDependencies = {},
): Promise<void> {
  const launchService = (dependencies.getLaunchService
    ?? (() => getFactoryFloorRuntime()?.activityLaunch))();
  if (!launchService) {
    await replySafely(
      interaction,
      'Factory Floor Activity launches are not enabled on this Discord Agent host.',
    );
    return;
  }

  const guildId = interaction.guildId;
  const installationOwnerId = interaction.authorizingIntegrationOwners?.get(
    GUILD_INSTALLATION_TYPE,
  );
  if (!guildId || !installationOwnerId || !interaction.guild) {
    await replySafely(
      interaction,
      'Factory Floor can only be opened from its authorized server installation.',
    );
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id)
    .catch(() => null);
  const authorize = dependencies.authorize ?? isAuthorized;

  const isThread = interaction.channel?.isThread?.() ?? false;
  const parentChannelId = isThread ? interaction.channel?.parentId : interaction.channelId;
  if (!parentChannelId) {
    await replySafely(
      interaction,
      'This Discord surface cannot be resolved to a registered project channel.',
    );
    return;
  }

  const prepared = await launchService.prepare({
    interactionId: interaction.id,
    applicationId: interaction.applicationId,
    installationType: 'guild',
    installationOwnerId,
    guildId,
    channelId: parentChannelId,
    ...(isThread ? { threadId: interaction.channelId } : {}),
    principalId: interaction.user.id,
    authorized: authorize(member),
  });

  if (!prepared.ok) {
    await replySafely(interaction, prepared.message);
    return;
  }

  try {
    await interaction.launchActivity();
  } catch (error) {
    launchService.invalidate(prepared.stateId, 'Discord LAUNCH_ACTIVITY callback failed');
    (dependencies.logger ?? (message => console.warn(message)))(
      `[factoryFloor] Activity launch acknowledgement failed: ${redactErrorMessage(error)}`,
    );
    await replySafely(
      interaction,
      'Factory Floor could not be opened. The one-time launch was cancelled; try again.',
    );
  }
}
