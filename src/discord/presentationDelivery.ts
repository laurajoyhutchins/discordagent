import type {
  CapabilityEvaluationContext,
  CapabilityEvaluationMember,
  CapabilityPermissionChannel,
} from './capabilities/evaluator.js';
import { evaluateCapability } from './capabilities/evaluator.js';
import { PROCESS_GATEWAY_INTENTS } from './capabilities/registry.js';
import { redactErrorMessage } from '../utils/redaction.js';

export type PresentationDeliveryMode = 'rich' | 'text' | 'none';

export interface PresentationDeliveryResult {
  readonly delivered: boolean;
  readonly mode: PresentationDeliveryMode;
}

export interface PresentationDeliveryOptions<Payload> {
  readonly context: CapabilityEvaluationContext;
  readonly sendCapabilityId: string;
  readonly send: (payload: Payload) => Promise<unknown>;
  readonly rich: Payload;
  readonly fallback: Payload;
  readonly label: string;
  readonly logger?: (message: string) => void;
}

interface DiscordCapabilityChannelLike {
  readonly id?: string;
  readonly guild?: {
    readonly members?: {
      readonly me?: unknown;
    };
  };
}

export function createMessageDeliveryContext(
  channel: unknown,
): CapabilityEvaluationContext {
  const candidate = channel as DiscordCapabilityChannelLike;
  return {
    member: (candidate.guild?.members?.me ?? null) as CapabilityEvaluationMember | null,
    channel: candidate.id
      ? candidate as unknown as CapabilityPermissionChannel
      : null,
    configuredIntents: PROCESS_GATEWAY_INTENTS,
  };
}

export async function deliverPresentation<Payload>(
  options: PresentationDeliveryOptions<Payload>,
): Promise<PresentationDeliveryResult> {
  const logger = options.logger ?? (message => console.warn(message));
  const sendCapability = evaluateCapability(options.sendCapabilityId, options.context);

  if (sendCapability.state === 'unavailable') {
    logger(`[discordDelivery] ${options.label} not sent: ${sendCapability.reason}`);
    return { delivered: false, mode: 'none' };
  }

  const embedCapability = evaluateCapability('core.message.embed', options.context);
  if (embedCapability.state === 'unavailable') {
    return sendFallback(options, logger);
  }

  try {
    await options.send(options.rich);
    return { delivered: true, mode: 'rich' };
  } catch (error) {
    logger(
      `[discordDelivery] ${options.label} embed send failed; trying plain text: `
      + redactErrorMessage(error),
    );
    return sendFallback(options, logger);
  }
}

async function sendFallback<Payload>(
  options: PresentationDeliveryOptions<Payload>,
  logger: (message: string) => void,
): Promise<PresentationDeliveryResult> {
  try {
    await options.send(options.fallback);
    return { delivered: true, mode: 'text' };
  } catch (error) {
    logger(
      `[discordDelivery] ${options.label} plain-text fallback failed: `
      + redactErrorMessage(error),
    );
    return { delivered: false, mode: 'none' };
  }
}
