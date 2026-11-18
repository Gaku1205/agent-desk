import { DashboardLive } from "@/components/LivePages";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { loadGithubLimits } from "@/lib/github/limits";
import { buildLocalBundles } from "@/lib/dashboard/bundle";
import { loadErrorsOf } from "@/lib/loadErrors";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { logout } from "../logout";
import { loadExtendedPeriod } from "./actions";

/**
 * Dashboard：期間で振り返る。`24h`・`7d` は取得がほかのページと同じ（`loadTurns` の分だけ。GitHub を読む回数は増やさない）。
 * `30d` は、選んだときだけ Server Action（`loadExtendedPeriod`）が60日分を専用に取る（5分覚える）
 */
export default async function DashboardPage() {
  const login = (await getSignedInLogin()) ?? undefined;
  const userToken = (await getGitHubToken()) ?? "";
  // 全部がそろうのを待たず、覚えている最後の結果と読めた分を先に出す（`loadTurnSteps`）
  const first = await loadTurnSteps(async ({ results, items, now, repos, complete }) => {
    const bundles = buildLocalBundles(results, now);
    // GitHub を読むのは、パイプラインの App の鍵の `GET /rate_limit` だけ（5分に1回まで）
    // そろう前の段は、この読み取りを待たない（覚えている残りだけで出す）
    const limits = await loadGithubLimits({
      userToken,
      repos,
      runs: bundles["24h"].summary.runs,
      now,
      knownOnly: !complete,
    });
    return {
      complete,
      props: {
        bundles,
        loadPeriod: loadExtendedPeriod,
        limits,
        now: now.toISOString(),
        errors: loadErrorsOf(results),
        repoCount: repos.length,
        nav: {
          repos,
          counts: countTurnItems(items),
          runningCounts: countRunningPipelineRows(results, now),
          login,
          logout,
        },
      },
    };
  });
  return <DashboardLive first={first} />;
}
