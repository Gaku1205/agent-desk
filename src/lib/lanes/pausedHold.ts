import type { PausedEntry } from "./source";

/** 押してから片づけるまで預かる Paused の1行：押した時点の中身と、並びの位置 */
export type HeldPaused = { entry: PausedEntry; index: number };

/**
 * 預かる行の位置を決める。すでに預かっていれば押した時点の位置のまま、
 * 初めてなら並びでの位置（無ければ 0）
 */
export function heldPausedIndex(before: HeldPaused | undefined, entries: readonly PausedEntry[], key: string): number {
  if (before) return before.index;
  return Math.max(
    entries.findIndex((entry) => entry.key === key),
    0,
  );
}

/**
 * 取り直した一覧に、預かっている行を戻す（docs/spec.md の Slots & Queue の Paused）。
 * 一覧にまだある行は押した時点の中身に置き換え、一覧から外れた行は押した時点の位置に差し込む。
 * `hidden` の行（片づけ済み）は、取り直しが古くて一覧に残っていても出さない
 */
export function withHeldPaused(
  entries: readonly PausedEntry[],
  held: ReadonlyMap<string, HeldPaused>,
  hidden: ReadonlySet<string> = new Set(),
): PausedEntry[] {
  const present = new Set(entries.map((entry) => entry.key));
  const rows = entries.map((entry) => held.get(entry.key)?.entry ?? entry);
  const missing = [...held.entries()]
    .filter(([key]) => !present.has(key))
    .sort((a, b) => a[1].index - b[1].index);
  for (const [, row] of missing) {
    rows.splice(Math.min(Math.max(row.index, 0), rows.length), 0, row.entry);
  }
  return rows.filter((entry) => !hidden.has(entry.key));
}
