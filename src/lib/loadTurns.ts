import { cache } from "react";
import { getGitHubToken, getSignedInLogin } from "./auth";
import { buildAddedNotices, type AddedNotice } from "./autoAdd";
import { getSettingsRepo } from "./config";
import { loadAddedLog, runAutoAdd } from "./github/autoAdd";
import { getRepoResults } from "./github/fetch";
import type { RepoResult } from "./github/types";
import { getReadRateLimit } from "./github/appToken";
import { forgetWatchedReposAfterResponse, isWebhookEnabled } from "./github/repoCache";
import {
  getAutoRefreshPlan,
  getChangeWatchPlan,
  hasAiTurnWork,
  IDLE_REFRESH_INTERVAL_MS,
  type ChangeWatchPlan,
} from "./refresh";
import { graceRefreshAt, nextGraceEnd } from "./graceRefresh";
import { buildTurnItems, type TurnItem } from "./turn";
import { appendLoadedWatchedRepos, loadWatchedRepos } from "./watchedRepos";

export type LoadedTurns = {
  results: RepoResult[];
  /** 自動で監視に足したリポジトリ（「いまの様子」のお知らせ。足してから24時間） */
  addedNotices: AddedNotice[];
  /** 全リポジトリの「あなたの番」（並び順どおり） */
  items: TurnItem[];
  /** 自動更新の間隔（取り直しのたびに決め直す）。止めるときは intervalMs が null で、再開する時刻（ISO文字列）が入る */
  refreshPlan: { intervalMs: number | null; resumeAt: string | null };
  /** Webhook で「変わった」ときだけ取り直すリポジトリ（`owner/repo`）と反映済みの印、今までどおりの間隔の取り直しが要るか */
  changeWatch: ChangeWatchPlan;
  /** 次に猶予（PR作成待ち15分・未着手10分）が終わる時刻の少し後（ISO文字列）。猶予の中の物が無ければ null */
  graceRefreshAt: string | null;
  now: Date;
};

/**
 * サーバー側で、監視リポジトリ全部を取って「あなたの番」を作る。
 * 1回のリクエストの中では、サイドバーとページで同じ結果を使う（件数を一致させるため）
 */
export const loadTurns = cache(async (): Promise<LoadedTurns> => {
  const now = new Date();
  const token = await getGitHubToken();
  if (!token) {
    return {
      results: [],
      addedNotices: [],
      items: [],
      refreshPlan: { intervalMs: IDLE_REFRESH_INTERVAL_MS, resumeAt: null },
      changeWatch: { changeRepos: [], appliedMarks: {}, needsIntervalRefresh: true },
      graceRefreshAt: null,
      now,
    };
  }
  const loaded = await loadWatchedRepos();
  let results = await getRepoResults(token, loaded.repos);
  // 工場が作った新しいリポジトリを、監視リストに自動で足す（テンプレートが無い・きっかけが無いときは何も呼ばない）
  const settingsRepo = getSettingsRepo();
  const added = await runAutoAdd({ token, login: await getSignedInLogin(), settingsRepo, results, now });
  if (added.length > 0) {
    // 覚えた監視リストは古くなったので、返事のあとで捨てる（次の表示で、足した物が消えないように）
    forgetWatchedReposAfterResponse();
    appendLoadedWatchedRepos(loaded, added);
    results = [...results, ...(await getRepoResults(token, added))];
  }
  const addedNotices = buildAddedNotices(await loadAddedLog({ token, settingsRepo, results, now }), loaded.repos, now);
  // 取り直しで受けた返事のあとの残りで決める（トークンは画面に渡さない）
  // 使った鍵（ログインした人のトークンと App の鍵）のうち、いちばん少ない残りで決める
  const { remaining, resetAt } = getReadRateLimit(token);
  const plan = getAutoRefreshPlan({
    hasAiWork: hasAiTurnWork(results, now),
    remaining,
    resetAt,
    now,
  });
  const graceEnd = nextGraceEnd(results, now);
  return {
    results,
    addedNotices,
    items: buildTurnItems(results, now),
    refreshPlan: { intervalMs: plan.intervalMs, resumeAt: plan.resumeAt?.toISOString() ?? null },
    changeWatch: getChangeWatchPlan(results, isWebhookEnabled()),
    graceRefreshAt: graceEnd ? graceRefreshAt(graceEnd).toISOString() : null,
    now,
  };
});
