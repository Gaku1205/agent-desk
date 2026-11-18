import { Lanes } from "@/components/Lanes";
import { getSignedInLogin } from "@/lib/auth";
import { buildLanesSource } from "@/lib/lanes/source";
import { loadTurns } from "@/lib/loadTurns";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { logout } from "../logout";

/**
 * Slots & Queue：いまの並列の枠・動いている物・順番待ち。
 * 取得はほかのページと同じ（`loadTurns` と `loadWatchedRepos` の分だけ。GitHub を読む回数は増やさない）
 */
export default async function LanesPage() {
  const { repos } = await loadWatchedRepos();
  const { results, items, now } = await loadTurns();

  return (
    <Lanes
      source={buildLanesSource(results, now)}
      now={now.toISOString()}
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
