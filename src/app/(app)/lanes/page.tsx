import { LanesLive } from "@/components/LivePages";
import { getSignedInLogin } from "@/lib/auth";
import { buildLanesSource } from "@/lib/lanes/source";
import { lanesReadMode } from "@/lib/lanes/readMode";
import { buildUsageSource } from "@/lib/lanes/usage";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { logout } from "../logout";

export const metadata = { title: "Slots & Queue" };

/**
 * Slots & Queue：いまの並列の枠・動いている物・順番待ち。
 * 取得はほかのページと同じ（GitHub を読む回数は増やさない）。全部のリポジトリがそろうのを待たず、
 * 覚えている最後の結果と読めた分を先に出し、読めた所から順に入れ替える（`loadTurnSteps`）
 */
export default async function LanesPage() {
  const login = (await getSignedInLogin()) ?? undefined;
  const first = await loadTurnSteps(({ results, items, now, repos, complete, errors, canSayEmpty, sync }) => ({
    complete,
    props: {
      // 読めなかったときの出し方（全部読めなかったときは数を `–` に、一部のときは「空」の文を出さない）
      readMode: lanesReadMode({ canSayEmpty: canSayEmpty ?? true, sync: sync ?? "ok", results }),
      source: buildLanesSource(results, now),
      usage: buildUsageSource(results, now),
      items,
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
  return <LanesLive first={first} />;
}
