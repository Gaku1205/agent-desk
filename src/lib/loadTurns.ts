import { cache } from "react";
import { getGitHubToken } from "./auth";
import { getRepoResults } from "./github/fetch";
import type { RepoResult } from "./github/types";
import { getRateLimit } from "./github/rateLimit";
import { getAutoRefreshPlan, hasAiTurnWork, IDLE_REFRESH_INTERVAL_MS } from "./refresh";
import { buildTurnItems, type TurnItem } from "./turn";
import { loadWatchedRepos } from "./watchedRepos";

export type LoadedTurns = {
  results: RepoResult[];
  /** 全リポジトリの「あなたの番」（並び順どおり） */
  items: TurnItem[];
  /** 自動更新の間隔（取り直しのたびに決め直す）。止めるときは intervalMs が null で、再開する時刻（ISO文字列）が入る */
  refreshPlan: { intervalMs: number | null; resumeAt: string | null };
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
      items: [],
      refreshPlan: { intervalMs: IDLE_REFRESH_INTERVAL_MS, resumeAt: null },
      now,
    };
  }
  const { repos } = await loadWatchedRepos();
  const results = await getRepoResults(token, repos);
  // 取り直しで受けた返事のあとの残りで決める（トークンは画面に渡さない）
  const { remaining, resetAt } = getRateLimit(token);
  const plan = getAutoRefreshPlan({
    hasAiWork: hasAiTurnWork(results, now),
    remaining,
    resetAt,
    now,
  });
  return {
    results,
    items: buildTurnItems(results, now),
    refreshPlan: { intervalMs: plan.intervalMs, resumeAt: plan.resumeAt?.toISOString() ?? null },
    now,
  };
});
