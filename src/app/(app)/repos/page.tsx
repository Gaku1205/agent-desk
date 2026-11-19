import { RepoListLive } from "@/components/LivePages";
import { getSignedInLogin } from "@/lib/auth";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { buildRepoRows } from "@/lib/repoList";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { logout } from "../logout";

export const metadata = { title: "すべてのリポジトリ" };

/**
 * すべてのリポジトリ：監視中の全部を一覧する。取得はほかのページと同じ（GitHub を読む回数は増やさない）。
 * 全部がそろうのを待たず、覚えている最後の結果と読めた分を先に出す（`loadTurnSteps`。まだ読めていない行は、数 0・時刻なしで出る）
 */
export default async function ReposPage() {
  const login = (await getSignedInLogin()) ?? undefined;
  const first = await loadTurnSteps(({ results, items, now, repos, complete, errors }) => ({
    complete,
    props: {
      rows: buildRepoRows(repos, results, items, now),
      now: now.toISOString(),
      // 読めなかったリポジトリ（覚えている結果を出していても入る）
      errors,
      nav: {
        repos,
        counts: countTurnItems(items),
        runningCounts: countRunningPipelineRows(results, now),
        login,
        logout,
      },
    },
  }));
  return <RepoListLive first={first} />;
}
