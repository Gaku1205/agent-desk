import { DashboardLive } from "@/components/LivePages";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { loadGithubLimits } from "@/lib/github/limits";
import { getSettingsRepo } from "@/lib/config";
import { buildServiceRows, type ServicesView } from "@/lib/dashboard/services";
import { loadCpuTotals } from "@/lib/github/cpuUsage";
import { loadSupabaseKeepalives } from "@/lib/github/supabaseKeepalive";
import { buildLocalBundles } from "@/lib/dashboard/bundle";
import { parsePeriodParam } from "@/lib/dashboard/period";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { unreadableMapOf } from "@/lib/navCounts";
import { getBuildMemo } from "@/lib/buildMemo";
import { countTurnItems } from "@/lib/turn";
import { logout } from "../logout";
import { loadExtendedPeriod } from "./actions";

export const metadata = { title: "Dashboard" };

/**
 * Dashboard：期間で振り返る。`24h`・`7d` は取得がほかのページと同じ（`loadTurns` の分だけ。GitHub を読む回数は増やさない）。
 * `30d` は、選んだときだけ Server Action（`loadExtendedPeriod`）が60日分を専用に取る（5分覚える）
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  // URL の期間（`?period=7d`）で最初の表示を描く。JS が動く前に期間のリンクを押しても切り替わる
  const initialPeriod = parsePeriodParam((await searchParams).period);
  const login = (await getSignedInLogin()) ?? undefined;
  const userToken = (await getGitHubToken()) ?? "";
  // 全部がそろうのを待たず、覚えている最後の結果と読めた分を先に出す（`loadTurnSteps`）
  const first = await loadTurnSteps(async ({ results, items, now, repos, complete, errors, pendingRepos }) => {
    // まだ届いていないリポジトリがある間は、足し算が終わっていないので、数は全部 `—`（読めた結果が無いときと同じ）
    const bundles = buildLocalBundles((pendingRepos ?? 0) > 0 ? [] : results, now);
    // GitHub を読むのは、パイプラインの App の鍵の `GET /rate_limit` だけ（5分に1回まで）
    // そろう前の段は、この読み取りを待たない（覚えている残りだけで出す）
    // Services の Supabase・Vercel の CPU（Dashboard を開いたときだけ。5分覚える）。そろう前の段は覚えている物だけ
    const [limits, supabase, cpuTotals] = await Promise.all([
      loadGithubLimits({
        userToken,
        repos,
        runs: bundles["24h"].summary.runs,
        now,
        knownOnly: !complete,
      }),
      loadSupabaseKeepalives({ token: userToken, repos, nowMs: now.getTime(), knownOnly: !complete }),
      loadCpuTotals({ token: userToken, settingsRepo: getSettingsRepo(), nowMs: now.getTime(), knownOnly: !complete }),
    ]);
    const services: ServicesView = {
      checkedAt: now.toISOString(),
      rows: buildServiceRows({ supabase, cpuTotals, limits, now }),
    };
    return {
      complete,
      props: {
        bundles,
        loadPeriod: loadExtendedPeriod,
        initialPeriod,
        limits,
        services,
        now: now.toISOString(),
        // 読めなかったリポジトリ（覚えている結果を出していても入る）
        errors,
        repoCount: repos.length,
        nav: {
          repos,
          counts: countTurnItems(items),
          runningCounts: getBuildMemo().runningCounts(results, now),
          countsUnreadable: unreadableMapOf(errors),
          login,
          logout,
        },
      },
    };
  });
  return <DashboardLive first={first} />;
}
