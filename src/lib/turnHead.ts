/** ホームの真ん中の1件の札の行の、番号の欄（`repo#23`。PR があれば `repo#23 PR #38`、PR だけの物は `repo PR #38`） */
export function turnHeadId(opts: { repo: string; number: number; pullOnly: boolean; pullNumber: number | null }): string {
  const { repo, number, pullOnly, pullNumber } = opts;
  if (pullOnly) return `${repo} PR #${number}`;
  return pullNumber === null ? `${repo}#${number}` : `${repo}#${number} PR #${pullNumber}`;
}

export type TurnHeadCell = "id" | "name" | "source" | "wait";

/**
 * 札の行の項目（番号 → Fix の題名 → 誰から → 待ち時間）。相手が無い項目は入れない。
 * 項目の間に ` · ` を置くのは描く側（`TurnRow`）。記号＋まとまりの名前は先頭に別に置く
 */
export function turnHeadCells(opts: { hasName: boolean; source: string | null }): TurnHeadCell[] {
  const cells: TurnHeadCell[] = ["id"];
  if (opts.hasName) cells.push("name");
  if (opts.source) cells.push("source");
  cells.push("wait");
  return cells;
}

/** 札の行を文字にしたもの（テスト・確かめ用）。`Fix · todo-app#23 PR #38 · 題名 · 企画AIから · 46分` */
export function turnHeadText(parts: { group: string; id: string; name: string | null; source: string | null; wait: string }): string {
  const cells = turnHeadCells({ hasName: parts.name !== null, source: parts.source });
  const text: Record<TurnHeadCell, string> = {
    id: parts.id,
    name: parts.name ?? "",
    source: parts.source ?? "",
    wait: parts.wait,
  };
  return [parts.group, ...cells.map((cell) => text[cell])].join(" · ");
}
