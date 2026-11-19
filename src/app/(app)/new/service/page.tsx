import { NewIssueForm } from "@/components/NewIssueForm";
import { loadTurns } from "@/lib/loadTurns";
import { newIssueRepos } from "@/lib/newIssue";
import { loadWatchedRepos } from "@/lib/watchedRepos";

export const metadata = { title: "新サービス" };

/** 新しいサービスを作る画面：監視リストのテンプレートリポジトリに、`新サービス：` のIssueを作る */
export default async function NewServicePage() {
  const [{ repos }, { results }] = await Promise.all([loadWatchedRepos(), loadTurns()]);
  const templates = newIssueRepos(repos, results).filter((repo) => repo.template);
  return <NewIssueForm mode="service" repos={templates} />;
}
