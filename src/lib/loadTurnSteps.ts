import { getGitHubToken } from "./auth";
import type { WatchedRepo } from "./config";
import { getRepoResult, getStaleRepoResult } from "./github/fetch";
import { syncRateHistory } from "./github/rateHistoryStore";
import type { RepoResult } from "./github/types";
import type { LoadError } from "./loadErrors";
import { resolveLoadState, type LoadState, type RepoLoad } from "./loadState";
import { loadTurns } from "./loadTurns";
import { DEFAULT_GATHER, gatherSteps, mapSteps, type Gathered, type Step } from "./steps";
import { buildTurnItems, type TurnItem } from "./turn";
import { loadWatchedRepos } from "./watchedRepos";
import type { AddedNotice } from "./autoAdd";

/** 覚えている古い結果を出している理由（新しい結果を待っている／読めなかった） */
export type StaleBecause = LoadState["staleBecause"];

/** その時点で出せる分の「あなたの番」と、その元（docs/spec.md の「全部のリポジトリを待つページ」） */
export type TurnsSoFar = {
  /** 出すリポジトリの結果（まだ読めていないリポジトリは入らない。覚えている古い結果のことも、読めなかった結果のこともある） */
  results: RepoResult[];
  items: TurnItem[];
  addedNotices: AddedNotice[];
  now: Date;
  /** その時点の監視リポジトリ（最後の段では、自動で足した物も入る） */
  repos: WatchedRepo[];
  /** 全部のリポジトリの新しい結果がそろった最後の段か（`loadTurns` と同じ中身） */
  complete: boolean;
  /** 覚えている古い結果を出しているときの、その内容の時刻（ISO）。無ければ無し */
  staleAt?: string | null;
  /** 覚えている古い結果を出している理由。出していなければ null */
  staleBecause?: StaleBecause;
  /** 読めなかったリポジトリと理由（覚えている古い結果を出していても入る） */
  errors: LoadError[];
  /** 「何も無い」と言ってよいか（`resolveLoadState` の `canSayEmpty`）。無ければ言ってよい */
  canSayEmpty?: boolean;
  /** 同期の状態（`resolveLoadState` の `sync`）。無ければ全部読めた */
  sync?: LoadState["sync"];
};

const isFailedResult = (result: RepoResult): boolean => !result.ok;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 最初の段で新しい結果がそろわないとき、先の段を組み立てる前に、全部がそろうのを待つ上限（ms）。
 * 組み立て（約1.4秒）より短くして、温まったとき（全部で約0.2秒）は組み立てを1回で済ませる
 */
export const FIRST_BUILD_WAIT_MS = 1000;

/** 段の中身（取得元ごとの新しい結果・古い結果）から、出す物を決める */
function stateOf(gathered: Gathered<RepoResult>): LoadState {
  const loads: RepoLoad[] =
    gathered.loads ?? gathered.results.map((result) => ({ fresh: result, stale: null }));
  return resolveLoadState(loads);
}

/**
 * 全部の新しい結果（`loadTurns`）のうち、読めなかったリポジトリを、覚えている最後の結果に置き換える。
 * 覚えている結果は同じリクエストの中で使い回す（`getStaleRepoResult`。GitHub の呼び出しは増えない）
 */
async function withRemembered(token: string, results: RepoResult[]): Promise<LoadState> {
  const loads = await Promise.all(
    results.map(
      async (result): Promise<RepoLoad> => ({
        fresh: result,
        stale: result.ok
          ? null
          : await getStaleRepoResult(token, { owner: result.owner, repo: result.repo }).catch(() => null),
      }),
    ),
  );
  return resolveLoadState(loads);
}

/** 出す結果（まだの所を除く） */
function shownResults(state: LoadState): RepoResult[] {
  return state.shown.filter((result): result is RepoResult => result !== null);
}

/**
 * 全部のリポジトリを使うページ（ホーム・Slots & Queue・Dashboard・すべてのリポジトリ）のための取得。
 * 全部がそろうのを待たず、覚えている最後の結果（古くてよい）と読めた分を先に返し、読めた所から順に次の段で入れ替える。
 * 最後の段は `loadTurns` の結果（自動で足したリポジトリ・お知らせも入る）。取得は `getRepoResult` を使い回すので、GitHub の呼び出しは増えない。
 * 読めなかった（失敗した）リポジトリは、覚えている最後の結果があれば、最後の段でもそれを出す（`resolveLoadState`）。
 * `build` は、段ごとにページの中身（画面の部品に渡す物）を作る
 */
export async function loadTurnSteps<T extends object>(
  build: (turns: TurnsSoFar) => T | Promise<T>,
): Promise<Step<T & { staleAt: string | null; staleBecause: StaleBecause }>> {
  const token = await getGitHubToken();
  const { repos } = await loadWatchedRepos();
  const last = async (): Promise<TurnsSoFar> => {
    const loaded = await loadTurns();
    // GitHub limits の履歴を残す（前に確かめてから10分以上たっているときだけ。書けなくても続ける）
    if (token) await syncRateHistory({ userToken: token, nowMs: loaded.now.getTime(), needStore: false });
    const state = token ? await withRemembered(token, loaded.results) : resolveLoadState([]);
    const results = token ? shownResults(state) : loaded.results;
    return {
      results,
      // 覚えている結果に置き換えた所があるときだけ作り直す（無ければ `loadTurns` と同じ物）
      items: state.staleRepos.length > 0 ? buildTurnItems(results, loaded.now) : loaded.items,
      addedNotices: loaded.addedNotices,
      now: loaded.now,
      repos: (await loadWatchedRepos()).repos,
      complete: true,
      staleAt: state.staleAt,
      staleBecause: state.staleBecause,
      errors: state.errors,
      canSayEmpty: state.canSayEmpty,
      sync: state.sync,
    };
  };
  const finish = async (turns: TurnsSoFar) => ({
    ...(await build(turns)),
    staleAt: turns.staleAt ?? null,
    staleBecause: turns.staleBecause ?? null,
  });
  if (!token || repos.length === 0) return { value: await finish(await last()), next: null };

  const gathered = await gatherSteps<RepoResult>(
    repos.map((repo) => ({
      fresh: getRepoResult(token, repo),
      stale: () => getStaleRepoResult(token, repo),
    })),
    { ...DEFAULT_GATHER, wait: sleep, isFailed: isFailedResult },
  );
  const partialOf = (step: Gathered<RepoResult>): TurnsSoFar => {
    const now = new Date();
    const state = stateOf(step);
    const loaded = shownResults(state);
    return {
      results: loaded,
      items: buildTurnItems(loaded, now),
      addedNotices: [],
      now,
      repos,
      complete: false,
      staleAt: state.staleAt,
      staleBecause: state.staleBecause,
      errors: state.errors,
      canSayEmpty: state.canSayEmpty,
      sync: state.sync,
    };
  };
  // 組み立て（`build`）は重い（全部のリポジトリで約1.4秒）ので、1回の表示で1回にする：
  // ・最初の段、または `FIRST_BUILD_WAIT_MS` までに全部の新しい結果がそろえば、仕上げの段だけを作る（1回）
  // ・それより遅いときだけ（GitHub から取り直している）、最初の段（覚えている結果・一部）を先に出し、仕上げと2回。間の段は作らない
  if (gathered.next === null) {
    try {
      return { value: await finish(await last()), next: null };
    } catch {
      // 仕上げが投げたときは、そろった分で出す（今までと同じ）
      return { value: await finish(partialOf(gathered.value)), next: null };
    }
  }
  /** 間の段は飛ばして、最後の段の中身を待つ */
  const lastGathered = async (step: Step<Gathered<RepoResult>>): Promise<Gathered<RepoResult>> =>
    step.next === null ? step.value : lastGathered(await step.next);
  const settling = lastGathered(gathered);
  // 最初の段の組み立て自体が約1.4秒かかるので、`FIRST_BUILD_WAIT_MS` までに全部の新しい結果がそろえば、
  // 先の段は作らずに仕上げの1回だけにする（最初に出るまでの時間はほぼ変わらない。キャッシュが温まっていれば、ここでそろう）
  const settledEarly = await Promise.race([settling.catch(() => null), sleep(FIRST_BUILD_WAIT_MS).then(() => null)]);
  if (settledEarly !== null) {
    try {
      return { value: await finish(await last()), next: null };
    } catch {
      return { value: await finish(partialOf(settledEarly)), next: null };
    }
  }
  const firstValue = await finish(partialOf(gathered.value));
  const final = async (): Promise<Step<typeof firstValue>> => {
    const settled = await settling;
    try {
      return { value: await finish(await last()), next: null };
    } catch {
      return { value: await finish(partialOf(settled)), next: null };
    }
  };
  return { value: firstValue, next: final() };
}

/** リポジトリのページの段の中身：出す結果と、その判定 */
export type RepoStepView = { result: RepoResult; state: LoadState };

/**
 * リポジトリのページのための取得：そのリポジトリの新しい結果が遅いとき（GitHub から取り直している・立ち上がった直後で
 * App の鍵を確かめている）は、覚えている最後の結果を先に返し、届いたら入れ替える。
 * 新しい結果が失敗したときは、覚えている最後の結果があればそれを出し続ける。`build` の2つ目は、新しい結果がそろった最後の段か
 */
export async function loadRepoSteps<T>(
  token: string,
  repo: WatchedRepo,
  build: (view: RepoStepView, complete: boolean) => T | Promise<T>,
): Promise<Step<T>> {
  const fresh = getRepoResult(token, repo);
  const gathered = await gatherSteps<RepoResult>([{ fresh, stale: () => getStaleRepoResult(token, repo) }], {
    ...DEFAULT_GATHER,
    wait: sleep,
    isFailed: isFailedResult,
  });
  // 取得元は1つで、出せる物が無い間は段を出さないので、結果は必ずある
  return mapSteps(gathered, async (step, isLast) => {
    const state = stateOf(step);
    return build({ result: state.shown[0] ?? (await fresh), state }, isLast);
  });
}
