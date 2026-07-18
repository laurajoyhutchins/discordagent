# Release process

## Versioning

This project uses [semantic versioning](https://semver.org/). The current version is `1.0.0` (pre-1.0 development).

## Release checklist

1. **Verify the branch** — ensure `main` passes all checks:
   ```bash
   npm run check
   ```
2. **Review documentation** — confirm documentation matches the implementation. Update any pages that drifted.
3. **Update `package.json` version** — follow semver for the scope of changes.
4. **Update `.env.example`** if environment variables were added or changed.
5. **Tag the release**:
   ```bash
   git tag -a v1.0.1 -m "v1.0.1"
   git push origin v1.0.1
   ```
6. **Create a GitHub release** — use the tag to create a release with a summary of changes.

## Documentation updates

Documentation changes that describe behavior (how-to guides, reference, tutorials) should be included in the release. Documentation changes that only improve explanation or restructuring (explanation, contributing) can be released independently.

## Before each release

1. Inspect the staged diff for credentials, device codes, absolute private paths, transcripts, and generated state.
2. Confirm examples use placeholders rather than working IDs or tokens.
3. Run the full smoke test suite: `npm run smoke:host` and `npm run smoke:discord` (requires a configured Discord environment).
