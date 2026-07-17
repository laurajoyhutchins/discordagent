import { EmbedBuilder } from 'discord.js';
import { redactSensitiveText, safeStringify } from '../utils/redaction.js';

const ERROR_COLOR = 0xed4245;
const DESCRIPTION_LIMIT = 4_000;

interface ErrorDetails {
  message: string;
  status?: string;
  type?: string;
  code?: string;
}

/** Build a Discord-native presentation for provider and application errors. */
export function buildErrorEmbed(error: unknown, title = 'Error'): EmbedBuilder {
  const source = errorText(error);
  const details = parseStructuredError(source);
  const description = details?.message ?? (looksLikeJson(source)
    ? 'The provider returned an error response, but no readable message was available.'
    : source);
  const embed = new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle(`❌ ${title}`)
    .setDescription(truncate(redactSensitiveText(description), DESCRIPTION_LIMIT))
    .setTimestamp();

  if (details?.status) embed.addFields({ name: 'Status', value: details.status, inline: true });
  if (details?.type) embed.addFields({ name: 'Type', value: details.type, inline: true });
  if (details?.code) embed.addFields({ name: 'Code', value: details.code, inline: true });
  return embed;
}

/** True when text contains a structured provider error that should be rendered as a card. */
export function isStructuredErrorMessage(text: string): boolean {
  return parseStructuredError(text) !== undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const serialized = safeStringify(error);
  return serialized ?? String(error);
}

function parseStructuredError(text: string): ErrorDetails | undefined {
  for (const candidate of jsonCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const nested = isRecord(parsed.error) ? parsed.error : parsed;
    const message = stringValue(nested.message) ?? stringValue(parsed.message);
    const isStructured = parsed.type === 'error'
      || parsed.status !== undefined
      || nested !== parsed;
    if (!message || !isStructured) continue;
    return {
      message,
      ...(label(parsed.status) ? { status: label(parsed.status) } : {}),
      ...(stringValue(nested.type) ? { type: stringValue(nested.type) } : {}),
      ...(label(nested.code) ? { code: label(nested.code) } : {}),
    };
  }
  return undefined;
}

function jsonCandidates(text: string): string[] {
  const candidates = [text.trim()];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  return candidates;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || (text.includes('{') && text.includes('}'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function label(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
