import type { MessageCreateOptions, TextChannel } from 'discord.js';
import {
  createMessageDeliveryContext,
  deliverPresentation,
  type PresentationDeliveryResult,
} from '../../discord/presentationDelivery.js';
import type { ReviewNotification } from '../reviewSource.js';
import { buildReviewEmbed, buildReviewText } from './roborevRenderer.js';

export interface RoborevDeliveryOptions {
  readonly logger?: (message: string) => void;
}

export function deliverRoborevNotification(
  channel: TextChannel,
  notification: ReviewNotification,
  options: RoborevDeliveryOptions = {},
): Promise<PresentationDeliveryResult> {
  const rich: MessageCreateOptions = {
    embeds: [buildReviewEmbed(notification)],
  };
  const fallback: MessageCreateOptions = {
    content: buildReviewText(notification),
  };

  return deliverPresentation({
    context: createMessageDeliveryContext(channel),
    sendCapabilityId: 'core.message.send',
    send: payload => channel.send(payload),
    rich,
    fallback,
    label: `RoboRev notification for ${notification.projectId}`,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
