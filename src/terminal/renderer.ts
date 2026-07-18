export function renderUserReply(prompt: string): string {
  return `${prompt}> `;
}

export function sanitizeTerminalError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const knownSafe = [
    'not registered',
    'unavailable',
    'not found',
    'already exists',
    'not authorized',
    'no task',
    'not initialized',
    'cannot',
    'invalid',
    'refused',
    'not available',
    'could not complete',
    'is not available',
    'no loop',
    'failed to',
  ];
  if (knownSafe.some(prefix => message.toLowerCase().includes(prefix))) {
    return message;
  }
  return 'An error occurred. Check the bot logs for details.';
}
