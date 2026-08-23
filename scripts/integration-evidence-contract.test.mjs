import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReviewClearance } from './review-clearance-state.mjs';

const HEAD_SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);

const evidence = ({
  sha = HEAD_SHA,
  ownerImpact = 'none',
  reviewThreads = '0',
} = {}) => `<!-- integration-evidence:v1 -->

Head: \`${sha}\`
Verification: CI passed for this exact head.
Review threads: ${reviewThreads}
Owner impact: ${ownerImpact}
Provenance: agent:integration-worker
Limitations: Exact head only.`;

const delegatedComment = (
  body = evidence(),
  association = 'COLLABORATOR',
) => ({
  id: 1,
  user: { login: 'scheduled-worker' },
  author_association: association,
  body,
  created_at: '2026-08-14T14:00:00Z',
  updated_at: '2026-08-14T14:00:00Z',
});

test('accepts exact-head delegated evidence with no owner impact', () => {
  assert.deepEqual(
    parseReviewClearance({
      comments: [delegatedComment()],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }),
    {
      state: 'cleared',
      reviewedHead: HEAD_SHA,
      commentId: 1,
      source: 'delegated-evidence',
      ownerImpact: 'none',
      provenance: 'agent:integration-worker',
    },
  );
});

test('ignores delegated evidence from an untrusted actor', () => {
  assert.deepEqual(
    parseReviewClearance({
      comments: [delegatedComment(evidence(), 'NONE')],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }),
    { state: 'missing', reviewedHead: null, commentId: null },
  );
});

test('rejects delegated evidence with material owner impact', () => {
  assert.equal(
    parseReviewClearance({
      comments: [delegatedComment(evidence({ ownerImpact: 'timeline' }))],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }).state,
    'not-cleared',
  );
});

test('rejects delegated evidence with unresolved review threads', () => {
  assert.equal(
    parseReviewClearance({
      comments: [delegatedComment(evidence({ reviewThreads: '1' }))],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }).state,
    'not-cleared',
  );
});

test('treats delegated evidence for another head as stale', () => {
  const parsed = parseReviewClearance({
    comments: [delegatedComment(evidence({ sha: OLD_SHA }))],
    ownerLogin: 'laurajoyhutchins',
    headSha: HEAD_SHA,
  });

  assert.equal(parsed.state, 'stale');
  assert.equal(parsed.reviewedHead, OLD_SHA);
});
