import type { CommentData, IssueData } from "./github/types";

/** 止めている印：`<!-- hold-blocking: #12,#15 -->`（docs/spec.md の「止めている印」） */
const MARK = /<!--\s*hold-blocking:([\s\S]*?)-->/;

/** パイプラインの書いた物か（作者が `…[bot]`） */
function isBot(author: string): boolean {
  return author.endsWith("[bot]");
}

/**
 * マージ待ち（`ai:hold`）のPRが止めている Issue の番号。
 * PRのコメントのうち、作者が `…[bot]` で本文に印を含む最新の物から、`#` の後ろの数字を全部取る。
 * 印が無い・数字が読めない（最新の印が空）ときは空。同じ番号は1つにする
 */
export function parseHoldBlocking(
  comments: Pick<CommentData, "issueNumber" | "author" | "body" | "createdAt" | "id">[],
  pullNumber: number,
): number[] {
  const marked = comments
    .filter((c) => c.issueNumber === pullNumber && isBot(c.author) && MARK.test(c.body))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    .at(-1);
  if (!marked) return [];
  const inner = MARK.exec(marked.body)?.[1] ?? "";
  const numbers: number[] = [];
  for (const match of inner.matchAll(/#(\d+)/g)) {
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > 0 && !numbers.includes(n)) numbers.push(n);
  }
  return numbers;
}

/** 補足の1行：`マージすると #12（題名）・#15（題名）が動き出します`（題名が見つからない番号は `#12` だけ） */
export function holdBlockingNote(numbers: number[], issues: Pick<IssueData, "number" | "title">[]): string | null {
  if (numbers.length === 0) return null;
  const parts = numbers.map((n) => {
    const title = issues.find((issue) => issue.number === n)?.title;
    return title ? `#${n}（${title}）` : `#${n}`;
  });
  return `マージすると ${parts.join("・")}が動き出します`;
}
