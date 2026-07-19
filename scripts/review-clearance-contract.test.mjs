import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReviewClearance } from './review-clearance-state.mjs';

const HEAD_SHA = 'a'.repeat(40);

test('rejects a clearance marker without the complete review sections', () => {
  assert.equal(
    parseReviewClearance({
      comments: [
        {
          id: 1,
          user: { login: 'laurajoyhutchins' },
          body: `<!-- review-clearance:v1 -->

Reviewed head: \`${HEAD_SHA}\`

Disposition: Cleared for merge.`,
          created_at: '2026-07-19T20:00:00Z',
          updated_at: '2026-07-19T20:00:00Z',
        },
      ],
      ownerLogin: 'laurajoyhutchins',
      headSha: HEAD_SHA,
    }).state,
    'not-cleared',
  );
});
