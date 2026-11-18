import { Dashboard } from "@/components/Dashboard";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { loadGithubLimits } from "@/lib/github/limits";
import { aiUsageAll } from "@/lib/dashboard/aiUsage";
import { summarizeAll } from "@/lib/dashboard/summary";
import { loadTurns } from "@/lib/loadTurns";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { logout } from "../logout";

/** Dashboard：期間で振り返る。取得はほかのページと同じ（`loadTurns` の分だけ。GitHub を読む回数は増やさない） */
export default async function DashboardPage() {
  const { repos } = await loadWatchedRepos();
  const { results, items, now } = await loadTurns();
  const summaries = summarizeAll(results, now);
  // GitHub を読むのは、パイプラインの App の鍵の `GET /rate_limit` だけ（5分に1回まで）
  const limits = await loadGithubLimits({
    userToken: (await getGitHubToken()) ?? "",
    repos,
    runs: summaries["24h"].runs,
    now,
  });

  return (
    <Dashboard
      summaries={summaries}
      limits={limits}
      aiUsages={aiUsageAll(results, now)}
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
