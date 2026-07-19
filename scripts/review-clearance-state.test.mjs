import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  determineReviewClearanceStatus,
  parseReviewClearance,
  selectAuthoritativeWorkflowRun,
  selectPullNumbersForClearanceEvent,
} from './review-clearance-state.mjs';

const HEAD_SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);

const clearanceBody = ({ sha = HEAD_SHA, disposition = 'Cleared for merge.' } = {}) => `<!-- review-clearance:v1 -->

## Final review

Reviewed head: \`${sha}\`

Scope reviewed:
- complete diff

Findings and changes:
- none

Verification:
- CI passed

Remaining limitations:
- none

Disposition: ${disposition}`;

test('selects pull requests for every supported event without duplication', () => {
  assert.deepEqual(
    selectPullNumbersForClearanceEvent({
      eventName: 'workflow_run',
      payload: {
        workflow_run: {
          pull_requests: [{ number: 54 }, { number: 55 }, { number: 54 }],
        },
      },
    }),
    [54, 55],
  );

  assert.deepEqual(
    selectPullNumbersForClearanceEvent({
      eventName: 'pull_request_target',
      payload: { pull_request: { number: 55 } },
    }),
    [55],
  );

  assert.deepEqual(
    selectPullNumbersForClearanceEvent({
      eventName: 'issue_comment',
      payload: { issue: { number: 55, pull_request: {} } },
    }),
    [55],
  );

  assert.deepEqual(
    selectPullNumbersForClearanceEvent({
      eventName: 'issue_comment',
      payload: { issue: { number: 55 } },
    }),
    [],
  );
});

test('selects only the authoritative exact-head workflow run for the pull request', () => {
  const runs = [
    {
      id: 1,
      name: 'CI',
      event: 'pull_request',
      head_sha: HEAD_SHA,
      pull_requests: [{ number: 55 }],
      status: 'completed',
      conclusion: 'failure',
      created_at: '2026-07-19T20:00:00Z',
    },
    {
      id: 2,
      name: 'CI',
      event: 'pull_request',
      head_sha: HEAD_SHA,
      pull_requests: [{ number: 56 }],
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-07-19T20:02:00Z',
    },
    {
      id: 3,
      name: 'Unrelated workflow',
      event: 'pull_request',
      head_sha: HEAD_SHA,
      pull_requests: [{ number: 55 }],
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-07-19T20:03:00Z',
    },
    {
      id: 4,
      name: 'CI',
      event: 'pull_request',
      head_sha: OLD_SHA,
      pull_requests: [{ number: 55 }],
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-07-19T20:04:00Z',
    },
  ];

  assert.deepEqual(
    selectAuthoritativeWorkflowRun(runs, {
      workflowName: 'CI',
      headSha: HEAD_SHA,
      pullNumber: 55,
    }),
    runs[0],
  );
});

test('accepts only an owner-authored exact-head clearance', () => {
  assert.deepEqual(
    parseReviewClearance({
      comments: [
        {
          id: 1,
          user: { login: 'someone-else' },
          body: clearanceBody(),
          created_at: '2026-07-19T20:00:00Z',
          updated_at: '2026-07-19T20:00:00Z',
        },
        {
          id: 2,
          user: { login: 'laurajoyhutchins' },
          body: clearanceBody(),
          created_at: '2026-07-19T20:01:00Z',
          updated_at: '2026-07-19T20:01:00Z',
        },
      ],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }),
    {
      state: 'cleared',
      reviewedHead: HEAD_SHA,
      commentId: 2,
    },
  );
});

test('treats an older-head clearance as stale and lets the latest decision supersede', () => {
  assert.equal(
    parseReviewClearance({
      comments: [
        {
          id: 1,
          user: { login: 'laurajoyhutchins' },
          body: clearanceBody({ sha: OLD_SHA }),
          created_at: '2026-07-19T20:00:00Z',
          updated_at: '2026-07-19T20:00:00Z',
        },
      ],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }).state,
    'stale',
  );

  assert.equal(
    parseReviewClearance({
      comments: [
        {
          id: 1,
          user: { login: 'laurajoyhutchins' },
          body: clearanceBody(),
          created_at: '2026-07-19T20:00:00Z',
          updated_at: '2026-07-19T20:00:00Z',
        },
        {
          id: 2,
          user: { login: 'laurajoyhutchins' },
          body: clearanceBody({ disposition: 'Not cleared for merge.' }),
          created_at: '2026-07-19T20:01:00Z',
          updated_at: '2026-07-19T20:01:00Z',
        },
      ],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }).state,
    'not-cleared',
  );
});

test('reports success only when exact-head CI, conversations, and clearance pass', () => {
  assert.equal(
    determineReviewClearanceStatus({
      draft: false,
      workflowRun: { status: 'completed', conclusion: 'success' },
      reviewThreads: { status: 'available', unresolvedCount: 0 },
      clearance: { state: 'cleared' },
    }).state,
    'success',
  );

  for (const input of [
    { draft: true, workflowRun: null, reviewThreads: null, clearance: null },
    {
      draft: false,
      workflowRun: { status: 'in_progress', conclusion: null },
      reviewThreads: { status: 'available', unresolvedCount: 0 },
      clearance: { state: 'cleared' },
    },
    {
      draft: false,
      workflowRun: { status: 'completed', conclusion: 'success' },
      reviewThreads: { status: 'available', unresolvedCount: 0 },
      clearance: { state: 'missing' },
    },
    {
      draft: false,
      workflowRun: { status: 'completed', conclusion: 'success' },
      reviewThreads: { status: 'available', unresolvedCount: 0 },
      clearance: { state: 'stale' },
    },
  ]) {
    assert.equal(determineReviewClearanceStatus(input).state, 'pending');
  }
});

test('fails closed for failed CI, unresolved threads, or unavailable review state', () => {
  assert.equal(
    determineReviewClearanceStatus({
      draft: false,
      workflowRun: { status: 'completed', conclusion: 'failure' },
      reviewThreads: { status: 'available', unresolvedCount: 0 },
      clearance: { state: 'cleared' },
    }).state,
    'failure',
  );

  assert.equal(
    determineReviewClearanceStatus({
      draft: false,
      workflowRun: { status: 'completed', conclusion: 'success' },
      reviewThreads: { status: 'available', unresolvedCount: 1 },
      clearance: { state: 'cleared' },
    }).state,
    'failure',
  );

  assert.equal(
    determineReviewClearanceStatus({
      draft: false,
      workflowRun: { status: 'completed', conclusion: 'success' },
      reviewThreads: { status: 'unavailable', unresolvedCount: null },
      clearance: { state: 'cleared' },
    }).state,
    'error',
  );
});

test('wires the trusted review-clearance workflow to the existing verify check', () => {
  const clearanceWorkflow = readFileSync(
    new URL('../.github/workflows/review-clearance.yml', import.meta.url),
    'utf8',
  );
  const ciWorkflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );

  assert.match(clearanceWorkflow, /statuses: write/);
  assert.match(clearanceWorkflow, /context: 'review \/ cleared'/);
  assert.match(
    clearanceWorkflow,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
  assert.match(clearanceWorkflow, /persist-credentials: false/);
  assert.match(clearanceWorkflow, /scripts\/review-clearance-state\.mjs/);
  assert.match(clearanceWorkflow, /issue_comment:/);
  assert.doesNotMatch(clearanceWorkflow, /github\.event\.pull_request\.head\.sha/);

  assert.match(ciWorkflow, /verify:/);
  assert.match(ciWorkflow, /name: verify/);
});
