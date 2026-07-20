# Trusted Activity OAuth Bootstrap Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a validated Discord Activity instance and DA-2 launch into a single-use principal-bound Factory Floor Activity session through a strict optional HTTPS broker.

**Architecture:** Add migration-backed PKCE state, strict Discord REST clients, a pure bootstrap orchestrator, an HTTP policy boundary, and an optional HTTPS lifecycle. Keep all browser inputs non-authoritative and revalidate Discord identity, location, participant, membership, and role state before consuming launch state.

**Tech Stack:** Node.js 22 built-ins, TypeScript, better-sqlite3, discord.js, Vitest, directional HMAC Factory Floor client.

## Global Constraints

- The broker is disabled by default and must not affect direct providers or gateway startup when unavailable.
- S256 is the only PKCE method.
- Secrets, codes, verifiers, access tokens, session tokens, and opaque state IDs are never logged or persisted beyond the specifically required hashed challenge/state rows.
- All browser-supplied authority is re-derived from Discord and DA-1/DA-2 persistence.
- HTTP responses are JSON, `no-store`, exact-origin CORS, bounded, and fail closed.

---

### Task 1: PKCE persistence

**Files:**
- Create: `src/db/factoryFloorOAuthMigration.ts`
- Create: `src/repositories/factoryFloorOAuthRepository.ts`
- Test: `src/repositories/factoryFloorOAuthRepository.test.ts`
- Modify: `src/db/migrations.ts`
- Modify: `src/repositories/factoryFloorLaunchRepository.ts`

**Interfaces:**
- Produces `FactoryFloorOAuthRepository.begin`, `verifyAndConsume`, and `cleanup`.
- Extends launch lookup with `findByInteractionId`.

- [ ] Write migration/repository tests for idempotent challenge registration, conflicting challenge rejection, expiry, verifier mismatch, one-time consumption, launch retirement, and cleanup.
- [ ] Run the focused tests and retain the missing-module red state.
- [ ] Implement migration 13 and minimal repository behavior.
- [ ] Run focused tests to green and commit.

### Task 2: Discord REST boundary

**Files:**
- Create: `src/factoryFloor/discordOAuthClient.ts`
- Test: `src/factoryFloor/discordOAuthClient.test.ts`

**Interfaces:**
- Produces `exchangeAuthorizationCode`, `getCurrentUser`, and `getActivityInstance`.

- [ ] Write failing tests for exact form encoding, client authentication, verifier/redirect forwarding, bot-authenticated instance lookup, response validation, timeout, size limits, and stable redacted errors.
- [ ] Implement the bounded fetch client.
- [ ] Run focused tests to green and commit.

### Task 3: Trusted bootstrap orchestration

**Files:**
- Create: `src/factoryFloor/activityBootstrapService.ts`
- Test: `src/factoryFloor/activityBootstrapService.test.ts`
- Modify: `src/factoryFloor/runtime.ts`

**Interfaces:**
- Produces `startOAuth` and `bootstrap` methods.
- Consumes DA-2 launch repository, PKCE repository, Discord REST boundary, current-member resolver, authorization policy, and DA-1 Factory Floor service client.

- [ ] Write failing tests for application, launch, location, participant, member, authorization, OAuth user, state, PKCE, and retired-binding mismatches.
- [ ] Write the successful project/run session mapping tests.
- [ ] Implement minimal orchestration and runtime composition.
- [ ] Run focused and runtime tests to green and commit.

### Task 4: Strict HTTP and HTTPS lifecycle

**Files:**
- Create: `src/factoryFloor/activityBootstrapHttp.ts`
- Create: `src/factoryFloor/activityBootstrapServer.ts`
- Test: `src/factoryFloor/activityBootstrapHttp.test.ts`
- Test: `src/factoryFloor/activityBootstrapServer.test.ts`
- Modify: `src/factoryFloor/config.ts`
- Modify: `src/factoryFloor/config.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Exposes `POST /api/v1/discord/activity/oauth/start` and `POST /api/v1/discord/activity/bootstrap`.
- Produces a disposable optional HTTPS server lifecycle.

- [ ] Write failing policy/config/lifecycle tests.
- [ ] Implement exact-origin CORS, JSON-only bodies, 8 KiB limit, stable errors, no-store responses, TLS configuration, startup isolation, and shutdown disposal.
- [ ] Run focused and full tests to green and commit.

### Task 5: Shared contract and documentation

**Files:**
- Create: `contracts/discord-activity/bootstrap-v1.json`
- Create: `src/factoryFloor/bootstrapContract.test.ts`
- Create: `docs/reference/discord-activity-bootstrap.md`
- Create: `docs/how-to/integrations/deploy-factory-floor-bootstrap-broker.md`
- Modify: `.env.example`
- Modify: `docs/reference/configuration.md`
- Modify: `docs/reference/compatibility.md`
- Modify: documentation indexes

- [ ] Freeze canonical request/response/error fixtures and raw SHA-256.
- [ ] Add identical Factory Floor provider/consumer fixture bytes and digest verification.
- [ ] Document official Discord contracts, deployment boundaries, configuration, secrets, smoke testing, and failure behavior.
- [ ] Run both repositories' exact verification gates.
- [ ] Review, clear, and merge the companion Factory Floor fixture PR before the Discord Agent consumer PR.
