import { redirect } from "next/navigation";
import { LayoutFeed } from "@/components/LayoutFeed";
import { isAuthExpired, SESSION_EXPIRED_PATH } from "@/lib/authExpired";
import { loadTurns } from "@/lib/loadTurns";
import { newIssueRepos } from "@/lib/newIssue";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/**
 * 全リポジトリを読み終えてから決まる物（左のバーなどの件数・自動更新の計画・Issueを書く欄・自動で足したお知らせ）を、
 * layout が Suspense の中に置いて後から流す。中央の中身はこれを待たずに出る。
 * `loadTurns` は同じリクエストの中で結果を使い回すので、GitHub の呼び出しは増えない
 */
export async function LayoutStream() {
  const loaded = await loadTurns();
  // トークンが使えなくなった（401）ら、ログアウトして理由つきでログインの画面へ。
  // 描画中は Cookie を消せないので、Route Handler に任せる
  if (isAuthExpired(loaded.results)) redirect(SESSION_EXPIRED_PATH);
  const { repos } = await loadWatchedRepos();

  return (
    <LayoutFeed
      plan={{
        loadedAt: loaded.now.toISOString(),
        refreshIntervalMs: loaded.refreshPlan.intervalMs,
        resumeAt: loaded.refreshPlan.resumeAt,
        changeRepos: loaded.changeWatch.changeRepos,
        appliedChangeMarks: loaded.changeWatch.appliedMarks,
        needsIntervalRefresh: loaded.changeWatch.needsIntervalRefresh,
        graceRefreshAt: loaded.graceRefreshAt,
      }}
      streamed={{
        counts: countTurnItems(loaded.items),
        runningCounts: countRunningPipelineRows(loaded.results, loaded.now),
        newIssueRepos: newIssueRepos(repos, loaded.results),
        addedNotices: loaded.addedNotices,
      }}
    />
  );
}
