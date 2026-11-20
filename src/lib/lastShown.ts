import type { TurnCounts } from "./turn";

// 前に出した数を覚えておき、読み込みの途中は新しい数が分かるまでそれを出し続ける
// （docs/spec.md の「途中の段の数は、前に出した数を出し続ける」）。ブラウザの localStorage に覚える。
// ブラウザでも使うので、サーバーだけの物は import しない

/** 前に出した数。数が全部そろったときに書く */
export type LastShown = {
  /** リポジトリ（`owner/repo` の小文字）ごとの Your turn・AI の数。札を出すか（1件以上か）の元にもなる */
  repos: Record<string, { turn: number; running: number }>;
  /** `Slots & Queue` の横の使用中の数（分からなかったときは null） */
  slotsInUse: number | null;
  /** Your turn の `ほかに N件` */
  rest: number | null;
};

export const LAST_SHOWN_KEY = "agent-desk:last-shown";

export const NO_LAST_SHOWN: LastShown = { repos: {}, slotsInUse: null, rest: null };

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 100000;

/** 覚えた文字列を読む。壊れていたら何も覚えていない扱い */
export function parseLastShown(raw: string | null): LastShown {
  if (!raw) return NO_LAST_SHOWN;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return NO_LAST_SHOWN;
    const source = data as Record<string, unknown>;
    const repos: LastShown["repos"] = {};
    if (typeof source.repos === "object" && source.repos !== null) {
      for (const [key, value] of Object.entries(source.repos)) {
        const entry = value as Record<string, unknown> | null;
        if (entry && isCount(entry.turn) && isCount(entry.running)) {
          repos[key.toLowerCase()] = { turn: entry.turn, running: entry.running };
        }
      }
    }
    return {
      repos,
      slotsInUse: isCount(source.slotsInUse) ? source.slotsInUse : null,
      rest: isCount(source.rest) ? source.rest : null,
    };
  } catch {
    return NO_LAST_SHOWN;
  }
}

/** 数がそろったときの、覚える形（読めなかったリポジトリは覚えない） */
export function lastShownOf(
  counts: TurnCounts,
  runningCounts: TurnCounts,
  repoKeys: string[],
  unreadable: Record<string, true>,
  slotsInUse: number | null,
  previous: LastShown,
): LastShown {
  const repos: LastShown["repos"] = {};
  for (const name of repoKeys) {
    const key = name.toLowerCase();
    if (unreadable[key]) {
      const before = previous.repos[key];
      if (before) repos[key] = before;
      continue;
    }
    repos[key] = { turn: counts.byRepo[key] ?? 0, running: runningCounts.byRepo[key] ?? 0 };
  }
  return { repos, slotsInUse: slotsInUse ?? previous.slotsInUse, rest: previous.rest };
}

/**
 * まだ届いていないリポジトリの数を、前に出した数で埋めた件数（届いた物はそのまま）。
 * 前に出した数が無いリポジトリは埋めない（「–」のまま）
 */
export function fillFromLastShown(
  counts: TurnCounts,
  runningCounts: TurnCounts,
  loaded: Record<string, true>,
  last: LastShown,
): { counts: TurnCounts; runningCounts: TurnCounts; loaded: Record<string, true> } {
  const nextCounts = { ...counts.byRepo };
  const nextRunning = { ...runningCounts.byRepo };
  const nextLoaded = { ...loaded };
  for (const [key, value] of Object.entries(last.repos)) {
    if (loaded[key]) continue;
    if (value.turn > 0) nextCounts[key] = value.turn;
    if (value.running > 0) nextRunning[key] = value.running;
    nextLoaded[key] = true;
  }
  return { counts: { byRepo: nextCounts }, runningCounts: { byRepo: nextRunning }, loaded: nextLoaded };
}

/**
 * `ほかに N件` に出す数：数がそろうまでは前に出した数（無ければ null＝出さない）、そろったら実際の数。
 * 途中の段の数（読めた分だけ）を出すと、あとから増えて見える
 */
export function restToShow(actual: number, settled: boolean, last: number | null): number | null {
  return settled ? actual : last;
}

export function readLastShown(): LastShown {
  try {
    return parseLastShown(window.localStorage.getItem(LAST_SHOWN_KEY));
  } catch {
    return NO_LAST_SHOWN;
  }
}

export function writeLastShown(value: LastShown): void {
  try {
    window.localStorage.setItem(LAST_SHOWN_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event("agent-desk:last-shown"));
  } catch {
    // 覚えられなくても、表示は変わらない
  }
}

/** useSyncExternalStore 用：覚えた文字列（サーバーでは null） */
export function subscribeLastShown(onChange: () => void): () => void {
  window.addEventListener("agent-desk:last-shown", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("agent-desk:last-shown", onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function lastShownSnapshot(): string | null {
  try {
    return window.localStorage.getItem(LAST_SHOWN_KEY);
  } catch {
    return null;
  }
}
