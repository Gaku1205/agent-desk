import type { CommentData } from "./github/types";
import { isOwnerAuthor, isPipelineAuthor } from "./question";

/** 止めた理由の印（Issue #520）：コメントの1行目 `<!-- paused: 理由 -->` から読んだ、理由と時刻 */
export type PausedMark = {
  /** 1行の理由（`PR #510 のマージ待ち`） */
  reason: string;
  /** 印のコメントを書いた時刻（「止めてからの時間」の起点） */
  at: string;
};

const PAUSED_PATTERN = /^<!--\s*paused:\s*(.*?)\s*-->\s*$/i;
const SKIP_LABEL = "ai:skip";

/** 1行目（前の空白を除く）が止めた理由の印なら、その理由。理由が空なら null */
export function pausedReason(body: string): string | null {
  const first = body.trimStart().split(/\r?\n/, 1)[0] ?? "";
  const reason = PAUSED_PATTERN.exec(first.trimEnd())?.[1]?.trim() ?? "";
  return reason === "" ? null : reason;
}

/**
 * そのIssueのコメントから、いちばん新しい止めた理由の印を読む（無ければ null）。
 * 信じるのは、リポジトリのオーナーかパイプラインの App（`…[bot]`）が書いたコメントだけ
 */
export function parsePausedMark(
  comments: readonly CommentData[],
  issueNumber: number,
  owner: string,
): PausedMark | null {
  let found: PausedMark | null = null;
  for (const comment of comments) {
    if (comment.issueNumber !== issueNumber) continue;
    if (!isPipelineAuthor(comment.author) && !isOwnerAuthor(comment.author, owner)) continue;
    const reason = pausedReason(comment.body);
    if (reason === null) continue;
    if (found === null || comment.createdAt >= found.at) found = { reason, at: comment.createdAt };
  }
  return found;
}

/**
 * わざと止めたIssueか：開いていて `ai:skip` が付いていて、止めた理由の印がある。
 * `ai:skip` が外れたら、印があっても null（普通の流れに戻る）
 */
export function pausedMark(
  issue: { number: number; state: string; labels: readonly string[] },
  comments: readonly CommentData[],
  owner: string,
): PausedMark | null {
  if (issue.state !== "open" || !issue.labels.includes(SKIP_LABEL)) return null;
  return parsePausedMark(comments, issue.number, owner);
}
