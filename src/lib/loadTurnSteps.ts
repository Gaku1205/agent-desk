import { getGitHubToken } from "./auth";
import type { WatchedRepo } from "./config";
import { getRepoResult, getStaleRepoResult } from "./github/fetch";
import type { RepoResult } from "./github/types";
import { loadTurns } from "./loadTurns";
import { appendStep, DEFAULT_GATHER, gatherSteps, mapSteps, type Step } from "./steps";
import { buildTurnItems, type TurnItem } from "./turn";
import { loadWatchedRepos } from "./watchedRepos";
import type { AddedNotice } from "./autoAdd";

/** その時点で出せる分の「あなたの番」と、その元（docs/spec.md の「全部のリポジトリを待つページ」） */
export type TurnsSoFar = {
  /** 読めたリポジトリの結果（まだ読めていないリポジトリは入らない。覚えている古い結果のこともある） */
  results: RepoResult[];
  items: TurnItem[];
  addedNotices: AddedNotice[];
  now: Date;
  /** その時点の監視リポジトリ（最後の段では、自動で足した物も入る） */
  repos: WatchedRepo[];
  /** 全部のリポジトリの新しい結果がそろった最後の段か（`loadTurns` と同じ中身） */
  complete: boolean;
};

/**
 * 全部のリポジトリを使うページ（ホーム・Slots & Queue・Dashboard・すべてのリポジトリ）のための取得。
 * 全部がそろうのを待たず、覚えている最後の結果（古くてよい）と読めた分を先に返し、読めた所から順に次の段で入れ替える。
 * 最後の段は `loadTurns` の結果（自動で足したリポジトリ・お知らせも入る）。取得は `getRepoResult` を使い回すので、GitHub の呼び出しは増えない。
 * `build` は、段ごとにページの中身（画面の部品に渡す物）を作る
 */
export async function loadTurnSteps<T>(build: (turns: TurnsSoFar) => T | Promise<T>): Promise<Step<T>> {
  const token = await getGitHubToken();
  const { repos } = await loadWatchedRepos();
  const last = async (): Promise<TurnsSoFar> => {
    const loaded = await loadTurns();
    return {
      results: loaded.results,
      items: loaded.items,
      addedNotices: loaded.addedNotices,
      now: loaded.now,
      repos: (await loadWatchedRepos()).repos,
      complete: true,
    };
  };
  if (!token || repos.length === 0) return { value: await build(await last()), next: null };

  const gathered = await gatherSteps<RepoResult>(
    repos.map((repo) => ({
      fresh: getRepoResult(token, repo),
      stale: () => getStaleRepoResult(token, repo),
    })),
    { ...DEFAULT_GATHER, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  );
  const partial = await mapSteps(gathered, ({ results }): TurnsSoFar => {
    const now = new Date();
    const loaded = results.filter((result): result is RepoResult => result !== null);
    return { results: loaded, items: buildTurnItems(loaded, now), addedNotices: [], now, repos, complete: false };
  });
  // 全部そろった段のあとに、`loadTurns` の結果（自動で足した物・お知らせ入り）で仕上げる
  return mapSteps(appendStep(partial, last), build);
}

/**
 * リポジトリのページのための取得：そのリポジトリの新しい結果が遅いとき（GitHub から取り直している・立ち上がった直後で
 * App の鍵を確かめている）は、覚えている最後の結果を先に返し、届いたら入れ替える。`build` の2つ目は、新しい結果か
 */
export async function loadRepoSteps<T>(
  token: string,
  repo: WatchedRepo,
  build: (result: RepoResult, complete: boolean) => T | Promise<T>,
): Promise<Step<T>> {
  const fresh = getRepoResult(token, repo);
  const gathered = await gatherSteps<RepoResult>([{ fresh, stale: () => getStaleRepoResult(token, repo) }], {
    ...DEFAULT_GATHER,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  // 取得元は1つで、出せる物が無い間は段を出さないので、結果は必ずある
  return mapSteps(gathered, async ({ results }, isLast) => build(results[0] ?? (await fresh), isLast));
}
