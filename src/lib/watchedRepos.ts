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

/**
 * 同期の中で自動で足したリポジトリを、この1回のリクエストの「監視するリポジトリ」にも入れる
 * （同じリクエストの帯・左の一覧・ページで、足したリポジトリをすぐ出すため。保存は済んでいる）
 */
export function appendLoadedWatchedRepos(loaded: LoadedWatchedRepos, added: WatchedRepo[]): void {
  const listed = new Set(loaded.repos.map(({ owner, repo }) => `${owner}/${repo}`.toLowerCase()));
  for (const repo of added) {
    const key = `${repo.owner}/${repo.repo}`.toLowerCase();
    if (listed.has(key)) continue;
    listed.add(key);
    loaded.repos.push(repo);
  }
}
