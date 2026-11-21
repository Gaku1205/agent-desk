import { loadStepLog } from "@/app/actions";
import { DeskLive } from "@/components/LivePages";
import { getSignedInLogin } from "@/lib/auth";
import { buildConversation } from "@/lib/conversation";
import { awayEventsOf, buildTrailEvents } from "@/lib/events";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { unreadableMapOf } from "@/lib/navCounts";
import { newIssueRepos } from "@/lib/newIssue";
import { getBuildMemo } from "@/lib/buildMemo";
import { activityOf } from "@/lib/lanes/source";
import { countTurnItems } from "@/lib/turn";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { logout } from "../logout";

const NO_COUNTS = { byRepo: {} };

// ホームの題名は `agent-desk` だけ（layout.tsx の default）

/**
 * ホーム：全部のリポジトリの「あなたの番」と「いまの様子」。全部がそろうのを待たず、覚えている最後の結果と読めた分を先に出し、
 * 読めた所から順に入れ替える（`loadTurnSteps`）。そろう前の段では、件数・Issueを書く欄の一覧・自動で足したお知らせは
 * layout が後から流す物を使う（`nav.countsPending`。リポジトリのページと同じ）
 *
 * `(home)` のグループに置くのは、読み込み中の骨組み（`loading.tsx`）を `(app)` 全体ではなくホームだけにするため
 * （`(app)` に置くと、見つからないURLの `[...missing]` まで Suspense に入り、`notFound()` が HTTP 200 になる）
 */
export default async function Home() {
  const login = (await getSignedInLogin()) ?? undefined;
  const first = await loadTurnSteps(({ results, items, now, repos, addedNotices, complete, errors, pendingRepos }) => {
    const trail = buildTrailEvents(results, now);
    return {
    complete,
    props: {
      items,
      messages: buildConversation(results, trail, now),
      // 「いない間のまとめ」の元：取得済みの出来事のうち、公開と止まりだけ（呼び出しは増やさない）
      awayEvents: awayEventsOf(trail),
      now: now.toISOString(),
      scope: { kind: "all" as const, repoCount: repos.length },
      // 読めなかったリポジトリ（覚えている結果を出していても入る）
      errors,
      // まだ届いていないリポジトリの数（あれば「ありません」「待ちが0件」と言わない）
      pendingRepos: pendingRepos ?? 0,
      notices: buildWatchdogNotices(results, now),
      addedNotices,
      nav: complete
        ? {
            repos,
            counts: countTurnItems(items),
            runningCounts: getBuildMemo().runningCounts(results, now),
            countsUnreadable: unreadableMapOf(errors),
            login,
            logout,
          }
        : { repos, counts: NO_COUNTS, runningCounts: NO_COUNTS, countsPending: true, login, logout },
      newIssueRepos: newIssueRepos(repos, results),
      // 上端の帯の右の1行（実装中・順番待ち。Slots & Queue と同じ数え方）
      activity: activityOf(results, now),
      loadStepLog,
    },
    };
  });
  return <DeskLive first={first} />;
}
