export const VERIFIED_CODEX_CLI_VERSION = '0.145.0' as const;

export interface CodexCliCompatibility {
  readonly compatible: boolean;
  readonly detectedVersion: string | null;
  readonly expectedVersion: typeof VERIFIED_CODEX_CLI_VERSION;
}

const SEMVER = /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/;

export function evaluateCodexCliVersion(versionOutput: string): CodexCliCompatibility {
  const detectedVersion = versionOutput.match(SEMVER)?.[1] ?? null;
  return {
    compatible: detectedVersion === VERIFIED_CODEX_CLI_VERSION,
    detectedVersion,
    expectedVersion: VERIFIED_CODEX_CLI_VERSION,
  };
}
