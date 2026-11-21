import { queueAfterNumber, type ChatMessage } from "./conversation";
import type { CommentData, RepoData } from "./github/types";

/** `ai:blocked` の待ち先（コメントの印 `<!-- blocked-by: owner/repo#N -->` の1つ分） */
export type BlockedByMark = { owner: string; repo: string; number: number };

const MARK = /<!--\s*blocked-by:\s*([\w.-]+)\/([\w.-]+)#(\d+)\s*-->/g;

/** Issue のコメントの `blocked-by` の印を全部読む（同じ相手は1つ。書かれた順） */
export function parseBlockedBy(comments: readonly CommentData[], issueNumber: number): BlockedByMark[] {
  const marks: BlockedByMark[] = [];
  const seen = new Set<string>();
  for (const comment of comments) {
    if (comment.issueNumber !== issueNumber) continue;
    for (const match of comment.body.matchAll(MARK)) {
      const mark = { owner: match[1], repo: match[2], number: Number(match[3]) };
      const key = `${mark.owner}/${mark.repo}#${mark.number}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      marks.push(mark);
    }
  }
  return marks;
}

/**
 * まだ開いている待ち先だけ。同じリポジトリの相手は、閉じた Issue・閉じた／マージ済みの PR を外す
 * （取れた物に無ければ開いているとみなす）。別のリポジトリの相手は取れないので残す
 */
export function openBlockedBy(
  marks: readonly BlockedByMark[],
  here: { owner: string; repo: string },
  data: Pick<RepoData, "issues" | "pulls">,
): BlockedByMark[] {
  return marks.filter((mark) => {
    if (mark.owner.toLowerCase() !== here.owner.toLowerCase() || mark.repo.toLowerCase() !== here.repo.toLowerCase()) {
      return true;
    }
    const issue = data.issues.find((item) => item.number === mark.number);
    if (issue) return issue.state !== "closed";
    const pull = data.pulls.find((item) => item.number === mark.number);
    if (pull) return pull.state === "open" && pull.merged !== true;
    return true;
  });
}

/** 待ち先の書き方：同じリポジトリは `#715`、別のリポジトリは `リポジトリ#715` */
export function blockedByLabel(mark: BlockedByMark, here: { owner: string; repo: string }): string {
  const same = mark.owner.toLowerCase() === here.owner.toLowerCase() && mark.repo.toLowerCase() === here.repo.toLowerCase();
  return same ? `#${mark.number}` : `${mark.repo}#${mark.number}`;
}

/**
 * ホームの `順番待ち N件（…）` のかっこの中。今すぐ始められる物（`ai:queue`）の先頭があれば `次：#136`。
 * `ai:blocked` だけなら `次：` とは出さず、先頭の待ち先から `#715 のあと`
 */
export function queueHeadText(
  queue: readonly Pick<ChatMessage, "repo" | "number" | "blocked" | "waitAfter" | "note">[],
  showRepo: boolean,
): string {
  const label = (m: { repo: string; number: number }) => (showRepo ? `${m.repo}#${m.number}` : `#${m.number}`);
  const ready = queue.find((m) => !m.blocked);
  if (ready) return `次：${label(ready)}`;
  const first = queue[0];
  if (first.waitAfter && first.waitAfter.length > 0) return afterText(first.waitAfter);
  const reasonAfter = queueAfterNumber(first.note);
  if (reasonAfter !== null) return afterText([`#${reasonAfter}`]);
  return `次：${label(first)}`;
}

/** ホームの順番待ちの `#715 のあと`・`#A + #B のあと` */
export function afterText(labels: readonly string[]): string {
  return `${labels.join(" + ")} のあと`;
}
