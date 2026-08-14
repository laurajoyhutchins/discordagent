export const REVIEW_CLEARANCE_MARKER = '<!-- review-clearance:v1 -->';
export const INTEGRATION_EVIDENCE_MARKER = '<!-- integration-evidence:v1 -->';

const REQUIRED_REVIEW_SECTIONS = [
  '## Final review',
  'Scope reviewed:',
  'Findings and changes:',
  'Verification:',
  'Remaining limitations:',
];
const TRUSTED_DELEGATED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

const isPullNumber = (value) => Number.isInteger(value) && value > 0;

const eventPullNumber = (payload) => {
  const pullNumber = payload.pull_request?.number;
  return isPullNumber(pullNumber) ? [pullNumber] : [];
};

export const selectPullNumbersForClearanceEvent = ({ eventName, payload }) => {
  if (
    eventName === 'pull_request_target' ||
    eventName === 'pull_request_review' ||
    eventName === 'pull_request_review_comment'
  ) {
    return eventPullNumber(payload);
  }

  if (eventName === 'issue_comment') {
    const pullNumber = payload.issue?.pull_request
      ? payload.issue?.number
      : null;
    return isPullNumber(pullNumber) ? [pullNumber] : [];
  }

  if (eventName === 'workflow_run') {
    return [
      ...new Set(
        (payload.workflow_run?.pull_requests ?? [])
          .map((pullRequest) => pullRequest.number)
          .filter(isPullNumber),
      ),
    ];
  }

  return [];
};

const timestamp = (value) => {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const selectAuthoritativeWorkflowRun = (
  runs,
  { workflowName, headSha, pullNumber },
) =>
  runs
    .filter(
      (run) =>
        run.name === workflowName &&
        run.event === 'pull_request' &&
        run.head_sha === headSha &&
        run.pull_requests?.some(
          (pullRequest) => pullRequest.number === pullNumber,
        ),
    )
    .sort((left, right) => {
      const timeDifference =
        timestamp(right.created_at) - timestamp(left.created_at);
      if (timeDifference !== 0) return timeDifference;
      return Number(right.id ?? 0) - Number(left.id ?? 0);
    })[0] ?? null;

export const readReviewThreadState = async ({
  graphql,
  owner,
  repo,
  pullNumber,
}) => {
  let after = null;
  let unresolvedCount = 0;

  do {
    const data = await graphql(
      `
        query ($owner: String!, $repo: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) {
              reviewThreads(first: 100, after: $after) {
                nodes { isResolved }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }
      `,
      { owner, repo, number: pullNumber, after },
    );
    const page = data.repository?.pullRequest?.reviewThreads;
    if (!page) {
      throw new Error('GitHub did not return pull-request review threads.');
    }

    unresolvedCount += page.nodes.filter((thread) => !thread.isResolved).length;
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !after) {
      throw new Error('GitHub review-thread pagination omitted an end cursor.');
    }
  } while (after);

  return { status: 'available', unresolvedCount };
};

const commentTimestamp = (comment) =>
  Math.max(timestamp(comment.updated_at), timestamp(comment.created_at));

const hasCompleteReviewRecord = (body) => {
  let offset = body.indexOf(REVIEW_CLEARANCE_MARKER);
  if (offset < 0) return false;

  for (const section of REQUIRED_REVIEW_SECTIONS) {
    offset = body.indexOf(section, offset + 1);
    if (offset < 0) return false;
  }

  return true;
};

const isTrustedDelegatedAuthor = (comment, ownerLogin) =>
  comment.user?.login === ownerLogin ||
  TRUSTED_DELEGATED_ASSOCIATIONS.has(
    String(comment.author_association ?? '').toUpperCase(),
  );

const latestClearanceRecord = (comments, ownerLogin) =>
  comments
    .filter((comment) => {
      const body = comment.body ?? '';
      const legacyOwnerReview =
        comment.user?.login === ownerLogin &&
        body.includes(REVIEW_CLEARANCE_MARKER);
      const delegatedEvidence =
        body.includes(INTEGRATION_EVIDENCE_MARKER) &&
        isTrustedDelegatedAuthor(comment, ownerLogin);
      return legacyOwnerReview || delegatedEvidence;
    })
    .sort((left, right) => {
      const timeDifference = commentTimestamp(right) - commentTimestamp(left);
      if (timeDifference !== 0) return timeDifference;
      return Number(right.id ?? 0) - Number(left.id ?? 0);
    })[0];

const parseLegacyOwnerReview = (comment, headSha) => {
  const reviewedHead = comment.body.match(
    /Reviewed head:\s*`([0-9a-f]{40})`/i,
  )?.[1];
  if (!reviewedHead || !hasCompleteReviewRecord(comment.body)) {
    return {
      state: 'not-cleared',
      reviewedHead: reviewedHead ?? null,
      commentId: comment.id,
    };
  }

  if (reviewedHead.toLowerCase() !== headSha.toLowerCase()) {
    return { state: 'stale', reviewedHead, commentId: comment.id };
  }

  const disposition = comment.body.match(
    /^Disposition:\s*(Cleared for merge\.|Not cleared for merge\.)\s*$/im,
  )?.[1];
  return {
    state:
      disposition?.toLowerCase() === 'cleared for merge.'
        ? 'cleared'
        : 'not-cleared',
    reviewedHead,
    commentId: comment.id,
  };
};

const parseDelegatedEvidence = (comment, headSha) => {
  const reviewedHead = comment.body.match(
    /^Head:\s*`([0-9a-f]{40})`\s*$/im,
  )?.[1];
  const ownerImpact = comment.body
    .match(/^Owner impact:\s*(.+?)\s*$/im)?.[1]
    ?.trim();
  const reviewThreads = comment.body.match(
    /^Review threads:\s*(\d+)\s*$/im,
  )?.[1];
  const provenance = comment.body
    .match(/^Provenance:\s*(.+?)\s*$/im)?.[1]
    ?.trim();
  const verification = comment.body
    .match(/^Verification:\s*(.+?)\s*$/im)?.[1]
    ?.trim();
  const limitations = comment.body
    .match(/^Limitations:\s*(.+?)\s*$/im)?.[1]
    ?.trim();
  const complete =
    Boolean(reviewedHead) &&
    Boolean(ownerImpact) &&
    reviewThreads !== undefined &&
    /^(?:agent|system):[^\s]+$/i.test(provenance ?? '') &&
    verification === 'CI passed for this exact head.' &&
    Boolean(limitations);

  if (!complete) {
    return {
      state: 'not-cleared',
      reviewedHead: reviewedHead ?? null,
      commentId: comment.id,
      source: 'delegated-evidence',
      ownerImpact: ownerImpact ?? null,
      provenance: provenance ?? null,
    };
  }

  if (reviewedHead.toLowerCase() !== headSha.toLowerCase()) {
    return {
      state: 'stale',
      reviewedHead,
      commentId: comment.id,
      source: 'delegated-evidence',
      ownerImpact,
      provenance,
    };
  }

  return {
    state:
      ownerImpact.toLowerCase() === 'none' && Number(reviewThreads) === 0
        ? 'cleared'
        : 'not-cleared',
    reviewedHead,
    commentId: comment.id,
    source: 'delegated-evidence',
    ownerImpact,
    provenance,
  };
};

export const parseReviewClearance = ({ comments, ownerLogin, headSha }) => {
  const latest = latestClearanceRecord(comments, ownerLogin);
  if (!latest) {
    return { state: 'missing', reviewedHead: null, commentId: null };
  }

  if (latest.body.includes(INTEGRATION_EVIDENCE_MARKER)) {
    return parseDelegatedEvidence(latest, headSha);
  }
  return parseLegacyOwnerReview(latest, headSha);
};

export const determineReviewClearanceStatus = ({
  draft,
  workflowRun,
  reviewThreads,
  clearance,
}) => {
  if (draft) {
    return {
      state: 'pending',
      description:
        'Draft pull request; technical integration eligibility is unavailable.',
    };
  }

  if (!workflowRun || workflowRun.status !== 'completed') {
    return {
      state: 'pending',
      description: 'Waiting for authoritative exact-head CI.',
    };
  }

  if (workflowRun.conclusion !== 'success') {
    return {
      state: 'failure',
      description: 'Authoritative exact-head CI did not pass.',
    };
  }

  if (reviewThreads?.status !== 'available') {
    return {
      state: 'error',
      description: 'Complete review-thread state is unavailable.',
    };
  }

  if (reviewThreads.unresolvedCount > 0) {
    return {
      state: 'failure',
      description: `${reviewThreads.unresolvedCount} review conversation(s) remain unresolved.`,
    };
  }

  if (clearance?.state === 'cleared') {
    return {
      state: 'success',
      description:
        clearance.source === 'delegated-evidence'
          ? 'Delegated technical integration evidence clears the exact current head.'
          : 'Legacy owner review clears the exact current head for merge.',
    };
  }

  if (clearance?.state === 'stale') {
    return {
      state: 'pending',
      description: 'Integration evidence does not match the current head SHA.',
    };
  }

  if (clearance?.state === 'not-cleared') {
    return {
      state: 'pending',
      description:
        'Latest technical integration evidence does not clear this head.',
    };
  }

  return {
    state: 'pending',
    description: 'Waiting for exact-head technical integration evidence.',
  };
};
