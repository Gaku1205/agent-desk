import type { TurnCounts } from "./turn";

// 左のバー・上端の帯の件数を、読み終えたリポジトリから順に入れる（docs/spec.md の「リポジトリのページは中央を先に出す」）。
// ブラウザでも使うので、サーバーだけの物は import しない

/** 1つのリポジトリを読み終えた時点の件数 */
export type RepoCountFeed = {
  /** `owner/repo`（小文字） */
  key: string;
  /** あなたの番の件数 */
  turn: number;
  /** AIが動いている件数 */
  running: number;
  /** この件数を作った描画の時刻（ISO文字列。layout が1回の描画で1つ決める） */
  renderedAt: string;
  /** 読めなかった（件数は 0 ではなく「–」にする） */
  unreadable?: boolean;
};

/** 読み終えたリポジトリの件数（全部を読み終える前の分も入る） */
export type NavCounts = {
  counts: TurnCounts;
  runningCounts: TurnCounts;
  /** 件数が届いたリポジトリ（`owner/repo` の小文字）。届いていない物は「–」を出す */
  loaded: Record<string, true>;
  /** 読めなかったリポジトリ（`owner/repo` の小文字）。札は残し、数は 0 ではなく「–」を出す */
  unreadable: Record<string, true>;
};

export const NO_NAV_COUNTS: NavCounts = {
  counts: { byRepo: {} },
  runningCounts: { byRepo: {} },
  loaded: {},
  unreadable: {},
};

/** 数の代わりに出す印（読み込み中・読めなかったとき） */
export const COUNT_DASH = "–";

/** 数の出し方：分からないとき（読み込み中・読めなかった）は `–`、そうでなければ数 */
export function countText(value: number, unavailable: boolean): string {
  return unavailable ? COUNT_DASH : String(value);
}

/** 読めなかったリポジトリ（`owner/repo`）を、小文字の鍵の表にする（ページが左のバーへ渡す） */
export function unreadableMapOf(errors: { repo: string }[]): Record<string, true> {
  const map: Record<string, true> = {};
  for (const { repo } of errors) map[repo.toLowerCase()] = true;
  return map;
}

/**
 * 枠を使っている作業の数。読めなかったリポジトリが1つでもあるときは null（`–` を出す。読めた分だけを全体の数にしない）
 */
export function slotsInUseOf(worksCount: number, unreadableCount: number): number | null {
  return unreadableCount > 0 ? null : worksCount;
}

/** 1つのリポジトリの件数を入れ替えた件数。0件は持たない（全部を数えたときと同じ形にする） */
export function withRepoCount(counts: TurnCounts, key: string, count: number): TurnCounts {
  const byRepo = { ...counts.byRepo };
  if (count > 0) byRepo[key] = count;
  else delete byRepo[key];
  return { byRepo };
}

/**
 * 読み終えたリポジトリの件数を入れる。
 * 全部を読み終えた結果（`fullRenderedAt` の描画）がもう入っていて、それより前の描画の件数なら、古いので入れない
 * （遅れて届いた前の取り直しで、新しい数を上書きしない）。時刻が読めないときは入れる
 */
export function applyRepoCount(current: NavCounts, feed: RepoCountFeed, fullRenderedAt: string | null): NavCounts {
  if (fullRenderedAt !== null) {
    const fullMs = Date.parse(fullRenderedAt);
    const feedMs = Date.parse(feed.renderedAt);
    if (!Number.isNaN(fullMs) && !Number.isNaN(feedMs) && feedMs < fullMs) return current;
  }
  const unreadable = { ...current.unreadable };
  if (feed.unreadable) {
    unreadable[feed.key] = true;
    // 読めなかった物は「届いた」にしない（前に入っていた件数も消す）
    const loaded = { ...current.loaded };
    delete loaded[feed.key];
    return {
      counts: withRepoCount(current.counts, feed.key, 0),
      runningCounts: withRepoCount(current.runningCounts, feed.key, 0),
      loaded,
      unreadable,
    };
  }
  delete unreadable[feed.key];
  return {
    counts: withRepoCount(current.counts, feed.key, feed.turn),
    runningCounts: withRepoCount(current.runningCounts, feed.key, feed.running),
    loaded: current.loaded[feed.key] ? current.loaded : { ...current.loaded, [feed.key]: true },
    unreadable,
  };
}

/**
 * 全部を読み終えた結果で入れ替える（監視しているリポジトリは全部「届いた」になる。読めなかった物は「届いた」にせず、
 * `unreadable` に入れる）
 */
export function fullNavCounts(
  counts: TurnCounts,
  runningCounts: TurnCounts,
  repoKeys: string[],
  unreadableKeys: string[] = [],
): NavCounts {
  const unreadable: Record<string, true> = {};
  for (const key of unreadableKeys) unreadable[key.toLowerCase()] = true;
  const loaded: Record<string, true> = {};
  for (const key of repoKeys) if (!unreadable[key.toLowerCase()]) loaded[key.toLowerCase()] = true;
  return { counts, runningCounts, loaded, unreadable };
}

/** そのリポジトリの件数がまだ届いていないか（「–」を出すか） */
export function isRepoCountPending(countsPending: boolean, loaded: Record<string, true> | undefined, key: string): boolean {
  return countsPending && loaded?.[key.toLowerCase()] !== true;
}

/** そのリポジトリの数を「–」にするか：まだ届いていない、または読めなかった */
export function isRepoCountUnavailable(
  countsPending: boolean,
  loaded: Record<string, true> | undefined,
  unreadable: Record<string, true> | undefined,
  key: string,
): boolean {
  return unreadable?.[key.toLowerCase()] === true || isRepoCountPending(countsPending, loaded, key);
}
