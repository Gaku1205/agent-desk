import type { RunEntry, SlotWork } from "./source";

/**
 * Slots & Queue：動いている処理（Actions の実行）を、属する席の行の下にぶら下げる（docs/spec.md の「Slots & Queue」）。
 * 手がかりは `RunEntry.issueNumber`（`runTarget` が、ブランチ・PR・題名から決めた番号）。GitHub は読まない
 */

export type AttachedRuns = {
  /** 席ごとの処理（席の作業の `key` → 処理。始まった時刻の古い順。処理が無い席はキーごと無い） */
  bySlot: Record<string, RunEntry[]>;
  /** 席に属さない処理（番号が分からない・席に無い Issue）。元の並びのまま */
  other: RunEntry[];
};

function startedOf(run: RunEntry): number {
  return run.startedMs ?? Number.MAX_SAFE_INTEGER;
}

/** 実行を、同じ owner/repo・同じ Issue 番号の席にぶら下げる。残りは other */
export function attachRuns(works: readonly SlotWork[], runs: readonly RunEntry[]): AttachedRuns {
  const seats = new Map(works.map((work) => [`${work.owner}/${work.repo}#${work.number}`, work.key]));
  const bySlot: Record<string, RunEntry[]> = {};
  const other: RunEntry[] = [];
  for (const run of runs) {
    const seat = run.issueNumber === null ? undefined : seats.get(`${run.owner}/${run.repo}#${run.issueNumber}`);
    if (seat === undefined) {
      other.push(run);
      continue;
    }
    (bySlot[seat] ??= []).push(run);
  }
  for (const list of Object.values(bySlot)) {
    list.sort((a, b) => startedOf(a) - startedOf(b) || a.key.localeCompare(b.key));
  }
  return { bySlot, other };
}
