const STATE_ISSUE_NUMBER = 72;
const STATE_MARKER = '<!-- coderabbit-review-queue-state -->';
const STATE_VERSION = 1;
const REQUEST_COOLDOWN_MS = 60 * 60 * 1000;
const CODERABBIT_BOT = 'coderabbitai[bot]';
const RATE_LIMIT_MARKER = 'rate limited by coderabbit.ai';
const RATE_LIMIT_DELAY = /Next included review available in\s+(\d+)\s+(minute|minutes|hour|hours)/i;
const REVIEW_COMMAND = '@coderabbitai review';

function defaultState() {
  return {
    version: STATE_VERSION,
    lastRequestAt: null,
    lastRequestPr: null,
    cooldownUntil: null,
    blockedPrs: [],
  };
}

function renderState(state) {
  return `${STATE_MARKER}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``;
}

function parseState(body) {
  const match = body.match(/<!-- coderabbit-review-queue-state -->\s*```json\s*([\s\S]*?)\s*```/);
  if (!match) return null;
  const state = JSON.parse(match[1]);
  if (state.version !== STATE_VERSION ||
      !Array.isArray(state.blockedPrs)) {
    throw new Error('CodeRabbit queue state comment has an unsupported format.');
  }
  return { ...defaultState(), ...state };
}

function parseResetTime(comment) {
  const match = comment.body?.match(RATE_LIMIT_DELAY);
  if (!match) return null;
  const duration = Number(match[1]) *
    (match[2].toLowerCase().startsWith('hour') ? 60 * 60 * 1000 : 60 * 1000);
  return Date.parse(comment.created_at) + duration;
}

async function saveState(github, owner, repo, commentId, state) {
  await github.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body: renderState(state),
  });
}

async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const now = Date.now();
  const stateComments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: STATE_ISSUE_NUMBER,
    per_page: 100,
  });
  let stateComment = stateComments
    .filter(comment => comment.body?.includes(STATE_MARKER))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  let state = stateComment ? parseState(stateComment.body) : defaultState();

  if (!stateComment) {
    const created = await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: STATE_ISSUE_NUMBER,
      body: renderState(state),
    });
    stateComment = created.data;
  }

  // Only open PRs are scanned. The management issue retains shared state even if
  // the PR that last triggered a review is closed or converted to a draft.
  const pullRequests = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  const records = [];
  for (const pr of pullRequests) {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: pr.number,
      per_page: 100,
    });
    const reviews = !pr.draft
      ? await github.paginate(github.rest.pulls.listReviews, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        })
      : [];
    records.push({ pr, comments, reviews });
  }

  const unrecognizedRateLimitPrs = new Set(state.blockedPrs);
  let cooldownUntil = state.cooldownUntil ? Date.parse(state.cooldownUntil) : 0;
  const rateLimitComments = records.flatMap(({ pr, comments }) =>
    comments
      .filter(comment => comment.user?.login === CODERABBIT_BOT &&
        comment.body?.toLowerCase().includes(RATE_LIMIT_MARKER))
      .map(comment => ({ pr, comment })),
  );

  // The last request's PR may have been closed since the previous run.
  if (state.lastRequestPr &&
      !records.some(({ pr }) => pr.number === state.lastRequestPr)) {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: state.lastRequestPr,
      per_page: 100,
    });
    for (const comment of comments) {
      if (comment.user?.login === CODERABBIT_BOT &&
          comment.body?.toLowerCase().includes(RATE_LIMIT_MARKER)) {
        rateLimitComments.push({
          pr: { number: state.lastRequestPr },
          comment,
        });
      }
    }
  }

  for (const { pr, comment } of rateLimitComments) {
    const resetTime = parseResetTime(comment);
    if (resetTime === null) {
      unrecognizedRateLimitPrs.add(pr.number);
    } else {
      cooldownUntil = Math.max(cooldownUntil, resetTime);
    }
  }

  state.blockedPrs = [...unrecognizedRateLimitPrs].sort((a, b) => a - b);
  state.cooldownUntil = cooldownUntil > now ? new Date(cooldownUntil).toISOString() : null;
  await saveState(github, owner, repo, stateComment.id, state);

  if (state.blockedPrs.length) {
    core.warning(`Skipping PR(s) with unrecognized CodeRabbit rate-limit comments: ${state.blockedPrs.join(', ')}.`);
  }
  if (cooldownUntil > now) {
    core.info(`Shared CodeRabbit review cooldown lasts until ${new Date(cooldownUntil).toISOString()}.`);
    return;
  }

  const lastRequestAt = state.lastRequestAt ? Date.parse(state.lastRequestAt) : 0;
  if (now - lastRequestAt < REQUEST_COOLDOWN_MS) {
    core.info(`Global one-hour request cooldown lasts until ${new Date(lastRequestAt + REQUEST_COOLDOWN_MS).toISOString()}.`);
    return;
  }

  const candidates = [];
  for (const { pr, comments, reviews } of records) {
    if (pr.draft || state.blockedPrs.includes(pr.number)) continue;
    const botComments = comments.filter(comment => comment.user?.login === CODERABBIT_BOT);
    const workflowRequests = comments
      .filter(comment => comment.body?.trim() === REVIEW_COMMAND)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const latestRequest = workflowRequests[0];
    const hasCoderabbitReview = reviews.some(review =>
      review.user?.login === CODERABBIT_BOT && review.commit_id === pr.head.sha) ||
      botComments.some(comment => {
        if (!comment.body?.includes('walkthrough_start') ||
            comment.body.toLowerCase().includes(RATE_LIMIT_MARKER)) return false;
        const reviewedCommit = comment.body.match(
          /change_assessment_commit:"([0-9a-f]+)"/i,
        )?.[1];
        return reviewedCommit === pr.head.sha;
      });

    if (hasCoderabbitReview) continue;
    if (latestRequest) {
      const requestTime = Date.parse(latestRequest.created_at);
      const gotRateLimited = botComments.some(comment =>
        Date.parse(comment.created_at) > requestTime &&
        comment.body?.toLowerCase().includes(RATE_LIMIT_MARKER));
      if (!gotRateLimited) continue;
    }
    candidates.push(pr);
  }

  if (!candidates.length) {
    core.info('No open, non-draft PR is waiting for a CodeRabbit review.');
    return;
  }

  candidates.sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
  const selected = candidates[0];
  const requestTime = new Date().toISOString();

  // Persist the shared cooldown before posting, so retries cannot spam comments
  // if the workflow is interrupted immediately after the API call.
  state.lastRequestAt = requestTime;
  state.lastRequestPr = selected.number;
  await saveState(github, owner, repo, stateComment.id, state);
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: selected.number,
    body: REVIEW_COMMAND,
  });
  core.info(`Requested an incremental CodeRabbit review for PR #${selected.number}.`);
}

module.exports = { run };
