# Production branch contract

The `production` branch identifies the exact Discord Agent commit approved for the unattended hosted service. It is a deployment pointer, not a parallel development branch.

## Branch roles

- `main` is the reviewed integration branch and should remain releasable.
- `production` is the exact commit approved for the persistent hosted instance.
- Routine feature, repair, dependency, and documentation pull requests target `main`.
- Feature branches and ordinary pull requests must not target `production`.
- Direct commits to `production` are prohibited. Promotion moves it to an already-reviewed commit from `main`.

## Activation boundary

The branch may exist before hosting is activated, but no automation should deploy from it until the hardened production hosting profile, backup and restore procedure, readiness checks, and rollback path are verified.

## Promotion procedure

1. Resolve and record the candidate commit SHA from `main`.
2. Run all required deterministic verification for that exact SHA.
3. Run any bounded credentialed canary required by the affected Discord or provider surface.
4. Confirm schema migration, SQLite backup, recovery, and rollback implications.
5. Fast-forward `production` to the exact verified candidate SHA. Do not create divergent history and do not force-push.
6. Deploy only from a clean checkout whose `HEAD` equals `origin/production`.
7. Verify liveness, readiness, Discord connectivity, required-provider availability, persistence health, and graceful restart behavior.
8. Record the deployed SHA and deployment evidence.

## Fail-closed conditions

Do not promote or deploy when:

- the candidate SHA changes after verification;
- required checks or canaries fail;
- migration, backup, restore, or rollback behavior is unclear;
- secrets, permissions, provider enablement, or writable-path boundaries are not explicit;
- the target checkout differs from `origin/production`;
- the production branch update is not a fast-forward to the intended verified `main` commit;
- post-deployment readiness or recovery checks fail.

## Incident repairs

A repair developed during an incident still lands through `main`, then promotes by exact SHA. Live host edits are temporary recovery actions only and must be reconciled into Git before the incident is closed.

## GitHub settings

Protect `production` against deletion and force pushes. Restrict direct updates so promotion remains deliberate. The repository's single-account approval policy does not require a formal GitHub `APPROVED` review state, but promotion still requires exact-head verification and explicit authorization.