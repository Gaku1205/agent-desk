import { Dashboard } from "@/components/Dashboard";
import { getSignedInLogin } from "@/lib/auth";
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

  return (
    <Dashboard
      summaries={summarizeAll(results, now)}
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
