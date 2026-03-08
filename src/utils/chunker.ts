const MAX_LENGTH = 1800;

export function chunkText(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline boundary
    let splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
    if (splitAt <= 0) {
      // Fall back to space
      splitAt = remaining.lastIndexOf(' ', MAX_LENGTH);
    }
    if (splitAt <= 0) {
      // Hard split
      splitAt = MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }

  return chunks;
}
