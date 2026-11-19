import { redirect } from "next/navigation";
import { LayoutFeed } from "@/components/LayoutFeed";
import { RepoFeed } from "@/components/RepoFeed";
import { isAuthExpired, SESSION_EXPIRED_PATH } from "@/lib/authExpired";
import type { WatchedRepo } from "@/lib/config";
import { getRepoResult } from "@/lib/github/fetch";
import { buildLanesSource } from "@/lib/lanes/source";
import { loadErrorsOf } from "@/lib/loadErrors";
import { resolveLoadState } from "@/lib/loadState";
import { slotsInUseOf } from "@/lib/navCounts";
import { loadTurns } from "@/lib/loadTurns";
import { newIssueRepos } from "@/lib/newIssue";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { summarizeDriftIssues } from "@/lib/selfCheck";
import { buildTurnItems, countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/**
 * 全リポジトリを読み終えてから決まる物（左のバーなどの件数・自動更新の計画・Issueを書く欄・自動で足したお知らせ）を、
 * layout が Suspense の中に置いて後から流す。中央の中身はこれを待たずに出る。
 * `loadTurns` は同じリクエストの中で結果を使い回すので、GitHub の呼び出しは増えない
 */
export async function LayoutStream({ renderedAt }: { renderedAt: string }) {
  const loaded = await loadTurns();
  // トークンが使えなくなった（401）ら、ログアウトして理由つきでログインの画面へ。
  // 描画中は Cookie を消せないので、Route Handler に任せる
  if (isAuthExpired(loaded.results)) redirect(SESSION_EXPIRED_PATH);
  const { repos } = await loadWatchedRepos();
  // 読めなかったリポジトリ：札は残し、数と「使用中」は 0 ではなく「–」にする
  const unreadableRepos = loadErrorsOf(loaded.results).map((error) => error.repo.toLowerCase());

  return (
    <LayoutFeed
      plan={{
        loadedAt: loaded.now.toISOString(),
        refreshIntervalMs: loaded.refreshPlan.intervalMs,
        resumeAt: loaded.refreshPlan.resumeAt,
        pausedBy: loaded.refreshPlan.pausedBy,
        changeRepos: loaded.changeWatch.changeRepos,
        appliedChangeMarks: loaded.changeWatch.appliedMarks,
        needsIntervalRefresh: loaded.changeWatch.needsIntervalRefresh,
        graceRefreshAt: loaded.graceRefreshAt,
        // 全部のリポジトリが読めなかった（同期の時刻を進めず、点を緑にしない）
        readFailed: resolveLoadState(loaded.results.map((result) => ({ fresh: result, stale: null }))).sync === "failed",
      }}
      streamed={{
        counts: countTurnItems(loaded.items),
        runningCounts: countRunningPipelineRows(loaded.results, loaded.now),
        newIssueRepos: newIssueRepos(repos, loaded.results),
        slotsInUse: slotsInUseOf(buildLanesSource(loaded.results, loaded.now).works.length, unreadableRepos.length),
        unreadableRepos,
        addedNotices: loaded.addedNotices,
        drift: summarizeDriftIssues(loaded.results),
        renderedAt,
      }}
    />
  );
}

/**
 * 1つのリポジトリを読み終えた時点で、そのリポジトリの件数（あなたの番・AIが動いている）だけを流す。
 * layout がリポジトリごとの Suspense の中に置く。左のバー・上端の帯の件数は、読み終えたリポジトリから順に入れ替わる
 * （手で押す「同期」でも、全部を待たない）。取得は `getRepoResult` で、ページ・`loadTurns` と同じ結果を使い回す
 * （GitHub の呼び出しは増えない）。数え方は `LayoutStream` の全部の件数と同じ。トークンは画面に渡さない
 */
export async function RepoStream({ token, repo, renderedAt }: { token: string; repo: WatchedRepo; renderedAt: string }) {
  const result = await getRepoResult(token, repo);
  const now = new Date();
  const key = `${repo.owner}/${repo.repo}`.toLowerCase();
  return (
    <RepoFeed
      repoKey={key}
      turn={countTurnItems(buildTurnItems([result], now)).byRepo[key] ?? 0}
      running={countRunningPipelineRows([result], now).byRepo[key] ?? 0}
      renderedAt={renderedAt}
      unreadable={!result.ok}
    />
  );
}
