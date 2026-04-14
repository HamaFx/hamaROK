export type WorkspaceCacheScope =
  | 'all'
  | 'reviewQueue'
  | 'rankings'
  | 'rankingRuns'
  | 'rankingReview'
  | 'scanJobs'
  | 'awsOcr';

const SCOPE_SUFFIX: Record<WorkspaceCacheScope, string> = {
  all: 'all',
  reviewQueue: 'review-queue',
  rankings: 'rankings',
  rankingRuns: 'ranking-runs',
  rankingReview: 'ranking-review',
  scanJobs: 'scan-jobs',
  awsOcr: 'aws-ocr',
};

function workspacePrefix(workspaceId: string) {
  return `workspace:${workspaceId}`;
}

export function workspaceCacheTag(
  workspaceId: string,
  scope: WorkspaceCacheScope = 'all'
) {
  return `${workspacePrefix(workspaceId)}:${SCOPE_SUFFIX[scope]}`;
}

export function workspaceCacheTags(workspaceId: string) {
  return {
    all: workspaceCacheTag(workspaceId, 'all'),
    reviewQueue: workspaceCacheTag(workspaceId, 'reviewQueue'),
    rankings: workspaceCacheTag(workspaceId, 'rankings'),
    rankingRuns: workspaceCacheTag(workspaceId, 'rankingRuns'),
    rankingReview: workspaceCacheTag(workspaceId, 'rankingReview'),
    scanJobs: workspaceCacheTag(workspaceId, 'scanJobs'),
    awsOcr: workspaceCacheTag(workspaceId, 'awsOcr'),
  };
}

export function scanJobCacheTag(scanJobId: string) {
  return `scan-job:${scanJobId}`;
}

export function rankingRunCacheTag(runId: string) {
  return `ranking-run:${runId}`;
}
