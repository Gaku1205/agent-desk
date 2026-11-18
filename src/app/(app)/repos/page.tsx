import { RepoList } from "@/components/RepoList";
import { getSignedInLogin } from "@/lib/auth";
import { loadErrorsOf } from "@/lib/loadErrors";
import { loadTurns } from "@/lib/loadTurns";
import { buildRepoRows } from "@/lib/repoList";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { logout } from "../logout";

/** すべてのリポジトリ：監視中の全部を一覧する。取得はほかのページと同じ（GitHub を読む回数は増やさない） */
export default async function ReposPage() {
  const { repos } = await loadWatchedRepos();
  const { results, items, now } = await loadTurns();

  return (
    <RepoList
      rows={buildRepoRows(repos, results, items, now)}
      now={now.toISOString()}
      errors={loadErrorsOf(results)}
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
