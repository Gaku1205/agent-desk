import { cache } from "react";
import { getGitHubToken } from "./auth";
import { getWatchedRepos } from "./config";
import { getRepoResults } from "./github/fetch";
import type { RepoResult } from "./github/types";
import { buildTurnItems, type TurnItem } from "./turn";

export type LoadedTurns = {
  results: RepoResult[];
  /** 全リポジトリの「あなたの番」（並び順どおり） */
  items: TurnItem[];
  now: Date;
};

/**
 * サーバー側で、監視リポジトリ全部を取って「あなたの番」を作る。
 * 1回のリクエストの中では、サイドバーとページで同じ結果を使う（件数を一致させるため）
 */
export const loadTurns = cache(async (): Promise<LoadedTurns> => {
  const now = new Date();
  const token = await getGitHubToken();
  if (!token) return { results: [], items: [], now };
  const results = await getRepoResults(token, getWatchedRepos());
  return { results, items: buildTurnItems(results, now), now };
});
