# Secret handling and redaction

## Redaction boundary

All provider output, error messages, and log data pass through `src/utils/redaction.ts` before reaching Discord or storage. The redaction engine matches:

- API keys (`sk-...`, `ghp_...`, etc.)
- Bearer tokens
- Credential assignments (`API_KEY=value`, `password=value`, etc.)
- Device codes and verification URLs
- JSON serialized secrets with sensitive keys

Redacted values are replaced with `[REDACTED]`.

## Where redaction is applied

| Destination | Redacted? |
|---|---|
| SQLite event payloads | Yes |
| Discord task thread messages | Yes |
| Discord control cards | Yes |
| Bot logs | Yes |
| Usage snapshots | Yes |
| Task objectives | Yes (stored objective is the redacted version) |

## What is never stored

The following are never persisted to SQLite or committed to the repository:

- Discord bot tokens
- Provider API keys, credentials, or session secrets
- Device codes or verification URLs
- Roborev webhook IDs or tokens
- `.env` file contents
- Provider login state (beyond session identity)

## Credential patterns in the codebase

Test fixtures may contain credential-like patterns for redaction testing. These are documented placeholders, not live credentials. A repository scan confirms no live credentials are present.

## Before every push

1. Inspect the staged diff for credentials, device codes, absolute private paths, transcripts, and generated state.
2. Confirm examples use placeholders rather than working IDs or tokens.
3. Rotate any credential immediately if it is ever committed, even if the commit is later removed.

## Related

- [Trust model](trust-model.md)
- [Authentication boundaries](authentication-boundaries.md)
- [Repository visibility](../../reference/filesystem-layout.md)
