import { LanesLive } from "@/components/LivePages";
import { getSignedInLogin } from "@/lib/auth";
import { buildLanesSource } from "@/lib/lanes/source";
import { buildUsageSource } from "@/lib/lanes/usage";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { logout } from "../logout";

/**
 * Slots & Queue：いまの並列の枠・動いている物・順番待ち。
 * 取得はほかのページと同じ（GitHub を読む回数は増やさない）。全部のリポジトリがそろうのを待たず、
 * 覚えている最後の結果と読めた分を先に出し、読めた所から順に入れ替える（`loadTurnSteps`）
 */
export default async function LanesPage() {
  const login = (await getSignedInLogin()) ?? undefined;
  const first = await loadTurnSteps(({ results, items, now, repos, complete }) => ({
    complete,
    props: {
      source: buildLanesSource(results, now),
      usage: buildUsageSource(results, now),
      items,
      now: now.toISOString(),
      nav: {
        repos,
        counts: countTurnItems(items),
        runningCounts: countRunningPipelineRows(results, now),
        login,
        logout,
      },
    },
  }));
  return <LanesLive first={first} />;
}
