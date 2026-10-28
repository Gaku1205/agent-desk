import { cache } from "react";
import { getGitHubToken } from "./auth";
import {
  chooseWatchedRepos,
  getSettingsRepo,
  type WatchedRepo,
  type WatchedReposSource,
} from "./config";
import { GitHubClient } from "./github/client";
import { readVariable, WATCHED_REPOS_VARIABLE } from "./github/settings";

export type LoadedWatchedRepos = {
  repos: WatchedRepo[];
  source: WatchedReposSource;
};

/**
 * 画面全体の「監視するリポジトリ」。`SETTINGS_REPO` の Variable `AGENT_DESK_WATCHED_REPOS` があればそれを、
 * 無い・読めなければ環境変数 `WATCHED_REPOS` を使う。
 * 1回のリクエストの中では、サイドバー・ページ・操作で同じ結果を使う
 */
export const loadWatchedRepos = cache(async (): Promise<LoadedWatchedRepos> => {
  const settingsRepo = getSettingsRepo();
  const token = settingsRepo ? await getGitHubToken() : null;
  let variable: string | null = null;
  if (settingsRepo && token) {
    try {
      variable = await readVariable(new GitHubClient(token), settingsRepo, WATCHED_REPOS_VARIABLE);
    } catch {
      // 権限が無いなどで読めなければ、環境変数を使う
      variable = null;
    }
  }
  return chooseWatchedRepos(variable);
});
