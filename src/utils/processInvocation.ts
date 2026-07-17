export interface ProcessInvocation {
  command: string;
  args: readonly string[];
}

/**
 * Windows cannot launch .cmd/.bat files through Node's shell-free spawn API.
 * Calling ComSpec itself keeps the Node child process shell-free while still
 * supporting package-manager shims such as Volta's codex.cmd.
 */
export function buildProcessInvocation(
  command: string,
  args: readonly string[],
  platform = process.platform,
  comSpec = process.env.ComSpec ?? 'cmd.exe',
): ProcessInvocation {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args: [...args] };
  }

  const commandLine = [command, ...args]
    .map(value => /[\s"&|<>^]/.test(value) ? `"${value.replace(/["^]/g, '^$&')}"` : value)
    .join(' ');
  return { command: comSpec, args: ['/d', '/s', '/c', commandLine] };
}
