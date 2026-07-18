import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { DiscordCapabilityDefinition } from './contracts.js';

export const PROCESS_GATEWAY_INTENTS = ['Guilds', 'GuildMessages', 'MessageContent', 'GuildMembers'] as const;

export const CAPABILITIES: readonly DiscordCapabilityDefinition[] = [
  {
    id: 'core.guild.access', name: 'Guild access', purpose: 'Reach the configured guild through the gateway.',
    category: 'core', requirement: 'core_runtime', scope: 'guild', intents: ['Guilds'],
    fallback: 'The bot cannot operate in this guild.', remediation: 'Install the bot in the configured guild and enable the Guilds intent.',
  },
  {
    id: 'core.channel.view', name: 'View channels', purpose: 'Read the project and task channels.',
    category: 'core', requirement: 'core_runtime', permission: 'ViewChannel', scope: 'channel',
    fallback: 'The bot cannot receive or display work in this channel.', remediation: 'Allow View Channel for the bot in the guild and channel.',
  },
  {
    id: 'core.message.send', name: 'Send messages', purpose: 'Reply to users and publish task output.',
    category: 'core', requirement: 'core_runtime', permission: 'SendMessages', scope: 'channel',
    fallback: 'The bot cannot reply in this channel.', remediation: 'Allow Send Messages for the bot in the channel.',
  },
  {
    id: 'core.message.embed', name: 'Embed links', purpose: 'Render task status, plans, commands, and results as embeds.',
    category: 'core', requirement: 'optional', permission: 'EmbedLinks', scope: 'channel',
    fallback: 'Task output uses readable plain text instead of embeds.', remediation: 'Allow Embed Links for richer task presentation.',
  },
  {
    id: 'core.message.attach', name: 'Attach files', purpose: 'Send generated files or other Discord attachments.',
    category: 'core', requirement: 'operation_specific', permission: 'AttachFiles', scope: 'channel',
    fallback: 'Attachment delivery is unavailable; text-only output remains available.', remediation: 'Allow Attach Files when a feature needs to upload files.',
  },
  {
    id: 'core.message.history', name: 'Read message history', purpose: 'Read task-thread history for replies and durable recovery context.',
    category: 'core', requirement: 'core_runtime', permission: 'ReadMessageHistory', scope: 'channel',
    fallback: 'The bot may not be able to inspect prior task messages.', remediation: 'Allow Read Message History for the bot in the channel.',
  },
  {
    id: 'task.thread.create.public', name: 'Create public task threads', purpose: 'Create one Discord task thread for a new prompt.',
    category: 'task', requirement: 'core_runtime', permission: 'CreatePublicThreads', scope: 'channel',
    fallback: 'New tasks are rejected before usage or repository state is created.', remediation: 'Allow Create Public Threads in the project channel.',
  },
  {
    id: 'task.thread.send', name: 'Send in task threads', purpose: 'Publish task cards, streamed output, and decisions inside threads.',
    category: 'task', requirement: 'core_runtime', permission: 'SendMessagesInThreads', scope: 'channel',
    fallback: 'The task cannot be started safely because its thread cannot be used.', remediation: 'Allow Send Messages in Threads for the bot.',
  },
  {
    id: 'task.thread.manage', name: 'Manage task threads', purpose: 'Manage or close task threads when a future UX enables it.',
    category: 'task', requirement: 'optional', permission: 'ManageThreads', scope: 'channel',
    fallback: 'Threads remain open for continuation.', remediation: 'Allow Manage Threads only if thread management is explicitly enabled.',
  },
  {
    id: 'task.control-card.pin', name: 'Pin task control cards', purpose: 'Keep the authoritative task card visible at the top of a thread.',
    category: 'task', requirement: 'optional', permission: 'PinMessages', scope: 'channel',
    fallback: 'The card is created and updated but is not pinned.', remediation: 'Allow Pin Messages in task threads.',
  },
  {
    id: 'decision.poll.send', name: 'Send polls', purpose: 'Use native Discord polls for future decisions.',
    category: 'decision', requirement: 'optional', permission: 'SendPolls', scope: 'channel',
    fallback: 'Decisions use existing buttons/selects or text prompts.', remediation: 'Allow Send Polls when native polls are enabled.',
  },
  {
    id: 'workspace.channel.manage', name: 'Manage channels', purpose: 'Create, configure, and delete project channels during setup.',
    category: 'workspace', requirement: 'bootstrap_only', permission: 'ManageChannels', scope: 'guild',
    fallback: 'Project setup cannot create or remove its private channels.', remediation: 'Temporarily allow Manage Channels for bootstrap, then remove it if no setup operation needs it.',
  },
  {
    id: 'workspace.role.manage', name: 'Manage roles', purpose: 'Change role configuration for a future workspace setup flow.',
    category: 'workspace', requirement: 'optional', permission: 'ManageRoles', scope: 'guild',
    fallback: 'Role provisioning remains manual.', remediation: 'Allow Manage Roles only for an explicitly enabled role-management feature.',
  },
  {
    id: 'workspace.webhook.manage', name: 'Manage webhooks', purpose: 'Support future webhook integrations.',
    category: 'workspace', requirement: 'optional', permission: 'ManageWebhooks', scope: 'guild',
    fallback: 'The bot uses authenticated bot messages; webhook personas are unavailable.', remediation: 'Allow Manage Webhooks only when webhook integrations are enabled.',
  },
  {
    id: 'event.create', name: 'Create scheduled events', purpose: 'Support future scheduled Discord events.',
    category: 'event', requirement: 'optional', permission: 'CreateEvents', scope: 'guild',
    fallback: 'Scheduled-event automation is unavailable.', remediation: 'Allow Create Events only when scheduled events are enabled.',
  },
  {
    id: 'audit.read', name: 'Read audit log', purpose: 'Support future audit-log reconciliation.',
    category: 'audit', requirement: 'optional', permission: 'ViewAuditLog', scope: 'guild',
    fallback: 'Audit reconciliation is unavailable.', remediation: 'Allow View Audit Log only when reconciliation is enabled.',
  },
  {
    id: 'voice.message.send', name: 'Send voice messages', purpose: 'Support future voice-message delivery.',
    category: 'voice', requirement: 'optional', permission: 'SendVoiceMessages', scope: 'channel',
    fallback: 'Voice messages are unavailable; text remains available.', remediation: 'Allow Send Voice Messages only when voice messages are enabled.',
  },
  {
    id: 'voice.connect', name: 'Connect to voice', purpose: 'Join a voice channel for a future live briefing.',
    category: 'voice', requirement: 'optional', permission: 'Connect', scope: 'channel', intents: ['GuildVoiceStates'],
    fallback: 'Live voice briefings are unavailable.', remediation: 'Allow Connect and enable Guild Voice States only when live voice is enabled.',
  },
  {
    id: 'voice.speak', name: 'Speak in voice', purpose: 'Deliver a future live voice briefing.',
    category: 'voice', requirement: 'optional', permission: 'Speak', scope: 'channel', intents: ['GuildVoiceStates'],
    fallback: 'Live voice briefings are unavailable.', remediation: 'Allow Speak only when live voice is enabled.',
  },
  {
    id: 'voice.status.set', name: 'Set voice-channel status', purpose: 'Support future voice-channel status updates.',
    category: 'voice', requirement: 'optional', permission: 'SetVoiceChannelStatus', scope: 'channel',
    fallback: 'Voice-channel status remains unchanged.', remediation: 'Allow Set Voice Channel Status only when enabled.',
  },
  {
    id: 'activity.launch', name: 'Launch an Activity', purpose: 'Represent a future embedded Activity entry point.',
    category: 'activity', requirement: 'future_application_feature', scope: 'channel',
    fallback: 'No Activity is launched; normal task threads remain available.', remediation: 'Configure the Activity entry point and application command separately.',
    applicationFeature: 'embedded_activities',
  },
];

export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map(capability => [capability.id, capability]));

export function getCapability(id: string): DiscordCapabilityDefinition {
  const capability = CAPABILITY_BY_ID.get(id);
  if (!capability) throw new Error(`Unknown Discord capability: ${id}`);
  return capability;
}

export function gatewayIntentBitsFor(names: readonly (keyof typeof GatewayIntentBits)[]): number {
  return names.reduce((bits, name) => bits | GatewayIntentBits[name], 0);
}

export function permissionBitsFor(names: readonly (keyof typeof PermissionFlagsBits)[]): bigint {
  return names.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);
}

export function permissionBitForCapability(id: string): bigint | undefined {
  const permission = getCapability(id).permission;
  return permission ? PermissionFlagsBits[permission] : undefined;
}
