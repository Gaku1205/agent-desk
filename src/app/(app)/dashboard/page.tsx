import { Dashboard } from "@/components/Dashboard";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { loadGithubLimits } from "@/lib/github/limits";
import { buildLocalBundles } from "@/lib/dashboard/bundle";
import { loadTurns } from "@/lib/loadTurns";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { logout } from "../logout";
import { loadExtendedPeriod } from "./actions";

/**
 * Dashboard：期間で振り返る。`24h`・`7d` は取得がほかのページと同じ（`loadTurns` の分だけ。GitHub を読む回数は増やさない）。
 * `30d` は、選んだときだけ Server Action（`loadExtendedPeriod`）が60日分を専用に取る（5分覚える）
 */
export default async function DashboardPage() {
  const { repos } = await loadWatchedRepos();
  const { results, items, now } = await loadTurns();
  const bundles = buildLocalBundles(results, now);
  // GitHub を読むのは、パイプラインの App の鍵の `GET /rate_limit` だけ（5分に1回まで）
  const limits = await loadGithubLimits({
    userToken: (await getGitHubToken()) ?? "",
    repos,
    runs: bundles["24h"].summary.runs,
    now,
  });

  return (
    <Dashboard
      bundles={bundles}
      loadPeriod={loadExtendedPeriod}
      limits={limits}
      now={now.toISOString()}
      repoCount={repos.length}
      nav={{
        repos,
        counts: countTurnItems(items),
        runningCounts: countRunningPipelineRows(results, now),
        login: (await getSignedInLogin()) ?? undefined,
        logout,
      }}
    />
  );
}
