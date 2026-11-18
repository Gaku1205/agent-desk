import type { CheckRunData, CommentData, CommitStatusData } from "./github/types";
import { isClaudeReviewCheck, reviewOutcome } from "./status";

/** AIのレビューの結果を知らせるコミットのステータスの名前 */
export const AI_REVIEW_CONTEXT = "AIレビュー";

/**
 * AIのレビューが済んでいるか（docs/spec.md の「レビューを依頼」）。次のどれかなら済んでいる：
 * - コミットのステータス `AIレビュー` が success
 * - レビューの check（`review`）が success
 * - `claude[bot]` の「## Code review」のコメントがある
 * ステータス・check が取れていない（undefined）ときは、コメントだけで決める
 */
export function isAiReviewDone(
  comments: CommentData[],
  pullNumber: number,
  checks?: { checkRuns: CheckRunData[]; statuses: CommitStatusData[] },
): boolean {
  if (reviewOutcome(comments, pullNumber) !== null) return true;
  if (!checks) return false;
  const statusOk = checks.statuses.some((s) => s.context === AI_REVIEW_CONTEXT && s.state === "success");
  const checkOk = checks.checkRuns.some(
    (c) => isClaudeReviewCheck(c) && c.status === "completed" && c.conclusion === "success",
  );
  return statusOk || checkOk;
}
