## Summary

<!-- What changed, why, and which issue owns the durable work? -->

Closes #

## Agent handoff

- Lifecycle state: `implementing | self-review | awaiting-ci | needs-attention | ready`
- Head SHA reviewed:
- Base branch and SHA:
- Current work:
- Open findings or review threads:
- External blocker:
- Next action:

The automated sticky handoff comment is resumable state, not approval. Update this section when scope, blockers, or the reviewed head changes.

## Boundaries and compatibility

- Provider-neutral runtime impact:
- Discord capability or authorization impact:
- Persistence, task, session, recovery, or worktree impact:
- Public command, configuration, or documentation impact:
- Backward-compatibility behavior:

## Failure and security behavior

- Startup, retry, cancellation, interruption, and recovery behavior:
- Credential, redaction, untrusted-input, or external-command impact:
- Rollback or disable path:

## Review discipline

- [ ] A fresh self-review covered the issue, complete current diff, provider/runtime boundaries, authorization, recovery, compatibility, and missing tests.
- [ ] All actionable review threads are resolved or linked to explicit follow-up issues.
- [ ] TDD red-state evidence is retained without leaving required CI intentionally red.
- [ ] The final reviewed SHA matches the successful required-check SHA.

## Verification

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:ci`
- [ ] `npm run build`
- [ ] `npm run check:docs`
- [ ] `git diff --check <base>...HEAD`
- [ ] `agent-ci-summary.json` retained for each CI job

Evidence and results:

## Deferred work

List deliberate follow-ups with issue links, or state `None`.
