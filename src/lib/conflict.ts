import type { IssueStatus } from "./status";

/** main とぶつかっているときの見せ方：`fixing`＝AIに直す依頼が出ている、`waiting`＝依頼はまだ */
export type ConflictKind = "waiting" | "fixing";

/**
 * AIの番のマージ待ち（自動マージ直前・レビュー前）か、修正の依頼が出ている段階で、
 * PRが main とコンフリクトしているか。人間の番（`ai:hold`）・それ以外の段階は null（今のまま）
 */
export function conflictKind(
  status: Pick<IssueStatus, "stage" | "mergeWait" | "pull">,
): ConflictKind | null {
  if (!status.pull?.conflicting) return null;
  if (status.stage === "fixing") return "fixing";
  if (
    status.stage === "mergeWaiting" &&
    (status.mergeWait === "autoMerge" || status.mergeWait === "needsReview")
  ) {
    return "waiting";
  }
  return null;
}

/** 文言（`docs/design.md` の「段階ごとの説明文」） */
export function conflictText(kind: ConflictKind): string {
  return kind === "fixing" ? "main とぶつかっています。AIが解消中です。待つだけです"
    : "main とぶつかっています。AIが解消します。待つだけです";
}
