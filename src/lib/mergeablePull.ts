import type { CommentData, PullChecks, PullData } from "./github/types";
import { ciState, isIssueLinkedPull, LABEL, reviewedWithoutIssues } from "./status";

/**
 * マージしてよいPRか（docs/spec.md の「マージしてよいPR」）：
 * openで、`ai:hold` が付き、レビューが「指摘なし」で終わり、CIが通っている
 */
export function isMergeablePull(
  pull: PullData,
  comments: CommentData[],
  checks: PullChecks | undefined,
): boolean {
  return (
    pull.state === "open" &&
    !pull.merged &&
    pull.labels.includes(LABEL.hold) &&
    reviewedWithoutIssues(comments, pull.number) &&
    ciState(checks?.checkRuns ?? []).state === "passed"
  );
}

/** Issueに紐づかない（本文の `Closes #` も `claude/issue-N-` のブランチも無い）「マージしてよいPR」 */
export function isUnlinkedMergeablePull(
  pull: PullData,
  comments: CommentData[],
  checks: PullChecks | undefined,
): boolean {
  return !isIssueLinkedPull(pull) && isMergeablePull(pull, comments, checks);
}

/** Issueに紐づかない「マージしてよいPR」を全部（PR番号の順） */
export function unlinkedMergeablePulls(
  pulls: PullData[],
  comments: CommentData[],
  pullChecks: Record<number, PullChecks>,
): PullData[] {
  return pulls
    .filter((pull) => isUnlinkedMergeablePull(pull, comments, pullChecks[pull.number]))
    .sort((a, b) => a.number - b.number);
}
