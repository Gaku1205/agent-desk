"use server";

import { getGitHubToken } from "@/lib/auth";
import { buildExtendedBundle, type PeriodBundle } from "@/lib/dashboard/bundle";
import { fetchExtendedRepos } from "@/lib/github/extended";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/**
 * Dashboard で `30d` を選んだときだけ呼ぶ。60日分を専用に取って（5分覚える）、`30d` の数字を返す。
 * 返すのは数えた小さな値だけ（トークンは返さない）。ログインしていない・取れないときは null（画面は `—`）
 */
export async function loadExtendedPeriod(key: unknown): Promise<PeriodBundle | null> {
  if (key !== "30d") return null;
  const token = await getGitHubToken();
  if (!token) return null;
  const { repos } = await loadWatchedRepos();
  const now = new Date();
  const results = await fetchExtendedRepos(token, repos, { now });
  // 読めたリポジトリが1つも無いときは、失敗として扱う（画面で読み直せる）
  if (results.length > 0 && results.every((result) => !result.ok)) return null;
  return buildExtendedBundle(results, now);
}
