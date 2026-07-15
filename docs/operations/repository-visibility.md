# Repository Visibility Review

**Decision:** keep the source repository public unless future work introduces proprietary implementation details, private deployment data, or third-party material that cannot be redistributed.

The project is an MIT-licensed derivative of DiscordClaude and is designed so that public source does not expose a deployed bot. Runtime authorization remains local to the configured Discord guild, roles, owner identity, project path boundary, and provider credentials.

## Public-safe boundaries

The repository must contain only source, tests, documentation, examples, and non-secret configuration placeholders. The following remain local and are excluded from version control:

- `.env` and Discord bot credentials;
- Claude and Codex login state, API keys, device codes, and provider session secrets;
- SQLite databases and journals;
- legacy `projects.json` registrations and absolute project paths;
- task transcripts, logs, build output, and local worktrees;
- private repository contents operated on by the bot.

The current `.gitignore` excludes `.env`, `src/data/projects.json`, SQLite files, logs, dependencies, and compiled output. A repository scan performed during this review found only documented placeholders and deliberate redaction test fixtures matching common credential patterns; no live credentials were identified.

## Review requirements

Before every push or release:

1. inspect the staged diff for credentials, device codes, absolute private paths, transcripts, and generated state;
2. confirm examples use placeholders rather than working IDs or tokens;
3. keep smoke tests read-only unless they are explicitly running on the private bot host;
4. rotate any credential immediately if it is ever committed, even when the commit is later removed;
5. make the repository private before adding proprietary code or deployment-specific data.

Public repository visibility does not imply public Discord access. The deployed bot remains intended for a private server with trusted users and explicit runtime authorization.
