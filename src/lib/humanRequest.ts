import type { CommentData } from "./github/types";

/** 清書AIが、人間にしかできない作業をIssueのコメントで頼むときの1行目の印（`claude-plan.yml`） */
const HUMAN_REQUEST_MARK = "<!-- human-request -->";
const CLAUDE_BOT = "claude[bot]";
const HEADING_PATTERN = /^#{1,6}\s/;
const LIST_MARK_PATTERN = /^(?:[-*]|\d+\.)\s+/;
/** PRの本文で、お願いの節を探す見出しの文字（先に書いた方を優先する） */
const SECTION_TITLES = ["人間にお願いしたいこと", "人間が手で確認すべきこと"];
const NONE_LINES = new Set(["なし", "特になし", "無し"]);

/** 清書AIのお願いのコメントの理由と、そのコメントの時刻 */
export type HumanRequestReason = { reason: string; createdAt: string };

/** Issueの最新の「お願いのコメント」（作者が `claude[bot]` で、本文に印を含む）の、印の行より後の最初の空でない行 */
export function humanRequestReason(
  comments: CommentData[],
  issueNumber: number,
): HumanRequestReason | null {
  const last = comments
    .filter(
      (comment) =>
        comment.issueNumber === issueNumber &&
        comment.author === CLAUDE_BOT &&
        comment.body.includes(HUMAN_REQUEST_MARK),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  if (!last) return null;
  const after = last.body.slice(last.body.indexOf(HUMAN_REQUEST_MARK) + HUMAN_REQUEST_MARK.length);
  // 印と同じ行に続く文字は、印の行の一部なので読まない
  const lines = after.split("\n").slice(1);
  const reason = lines.map((line) => line.trim()).find((line) => line !== "");
  return reason ? { reason, createdAt: last.createdAt } : null;
}

function sectionLines(lines: string[], title: string): string[] | null {
  const start = lines.findIndex((line) => HEADING_PATTERN.test(line) && line.includes(title));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING_PATTERN.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .map((line) => line.trim().replace(LIST_MARK_PATTERN, "").trim())
    .filter((line) => line !== "");
}

/** PRの本文の「人間にお願いしたいこと」（無ければ「人間が手で確認すべきこと」）の節から、お願いの行を取り出す */
export function pullRequestAsks(body: string): string[] {
  const lines = body.split(/\r?\n/);
  for (const title of SECTION_TITLES) {
    const section = sectionLines(lines, title);
    if (section === null) continue;
    return section.length === 0 || NONE_LINES.has(section[0]) ? [] : section;
  }
  return [];
}

/** `ai:hold` のPRの説明文：`マージの前に：{最初の行}`（2行以上なら `（ほか{N}件）`）。お願いが無ければ null */
export function holdRequestText(body: string): string | null {
  const asks = pullRequestAsks(body);
  if (asks.length === 0) return null;
  const more = asks.length > 1 ? `（ほか${asks.length - 1}件）` : "";
  return `マージの前に：${asks[0]}${more}`;
}

/** 理由の末尾の `。` を取る（あとに `。` をつなげても重ならないように） */
export function trimTrailingPeriod(reason: string): string {
  return reason.replace(/。+$/, "");
}
