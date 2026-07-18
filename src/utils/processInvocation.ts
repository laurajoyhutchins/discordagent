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
  if (platform !== 'win32') {
    return { command, args: [...args] };
  }

  // .cmd/.bat files cannot be launched directly through spawn with shell:false.
  // .exe and .com files can be launched directly.
  // Bare command names (no extension, no path) may resolve to .cmd/.bat shims
  // (Volta, npm, etc.) via PATHEXT, which spawn does not honor. Use ComSpec
  // so that Windows performs proper PATH and PATHEXT resolution.
  if (/\.(?:cmd|bat)$/i.test(command)) {
    const commandLine = [command, ...args]
      .map(value => /[\s"&|<>^]/.test(value) ? `"${value.replace(/["^]/g, '^$&')}"` : value)
      .join(' ');
    return { command: comSpec, args: ['/d', '/s', '/c', commandLine] };
  }
  if (/\.(?:exe|com)$/i.test(command) || command.includes('\\') || command.includes('/')) {
    return { command, args: [...args] };
  }
  const commandLine = [command, ...args]
    .map(value => /[\s"&|<>^]/.test(value) ? `"${value.replace(/["^]/g, '^$&')}"` : value)
    .join(' ');
  return { command: comSpec, args: ['/d', '/s', '/c', commandLine] };
}
