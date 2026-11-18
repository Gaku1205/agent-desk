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
};

/** 読み終えたリポジトリの件数（全部を読み終える前の分も入る） */
export type NavCounts = {
  counts: TurnCounts;
  runningCounts: TurnCounts;
  /** 件数が届いたリポジトリ（`owner/repo` の小文字）。届いていない物は「–」を出す */
  loaded: Record<string, true>;
};

export const NO_NAV_COUNTS: NavCounts = { counts: { byRepo: {} }, runningCounts: { byRepo: {} }, loaded: {} };

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
  return {
    counts: withRepoCount(current.counts, feed.key, feed.turn),
    runningCounts: withRepoCount(current.runningCounts, feed.key, feed.running),
    loaded: current.loaded[feed.key] ? current.loaded : { ...current.loaded, [feed.key]: true },
  };
}

/** 全部を読み終えた結果で入れ替える（監視しているリポジトリは全部「届いた」になる） */
export function fullNavCounts(counts: TurnCounts, runningCounts: TurnCounts, repoKeys: string[]): NavCounts {
  const loaded: Record<string, true> = {};
  for (const key of repoKeys) loaded[key.toLowerCase()] = true;
  return { counts, runningCounts, loaded };
}

/** そのリポジトリの件数がまだ届いていないか（「–」を出すか） */
export function isRepoCountPending(countsPending: boolean, loaded: Record<string, true> | undefined, key: string): boolean {
  return countsPending && loaded?.[key.toLowerCase()] !== true;
}
