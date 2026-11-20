import { NewServiceLive } from "@/components/LivePages";
import { getSignedInLogin } from "@/lib/auth";
import { loadTurnSteps } from "@/lib/loadTurnSteps";
import { newIssueRepos } from "@/lib/newIssue";
import { unreadableMapOf } from "@/lib/navCounts";
import { getBuildMemo } from "@/lib/buildMemo";
import { countTurnItems } from "@/lib/turn";
import { logout } from "../../logout";

export const metadata = { title: "新サービス" };

/**
 * 新しいサービスを作る画面：監視リストのテンプレートリポジトリに、`新サービス：` のIssueを作る。
 * 左のバーの取得は Slots & Queue と同じ（`loadTurnSteps`＋`nav`。GitHub を読む回数は増やさない）
 */
export default async function NewServicePage() {
  const login = (await getSignedInLogin()) ?? undefined;
  const first = await loadTurnSteps(({ results, items, now, repos, complete, errors }) => ({
    complete,
    props: {
      repos: newIssueRepos(repos, results).filter((repo) => repo.template),
      nav: {
        repos,
        counts: countTurnItems(items),
        runningCounts: getBuildMemo().runningCounts(results, now),
        countsUnreadable: unreadableMapOf(errors),
        login,
        logout,
      },
    },
  }));
  return <NewServiceLive first={first} />;
}
