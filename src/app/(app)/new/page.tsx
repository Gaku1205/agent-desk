import { NewIssueForm } from "@/components/NewIssueForm";
import { loadTurns } from "@/lib/loadTurns";
import { newIssueRepos } from "@/lib/newIssue";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/** Issueを書く画面：監視しているリポジトリから選んで、1行のメモを書く */
export default async function NewIssuePage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const [{ repos }, { results }, { repo }] = await Promise.all([loadWatchedRepos(), loadTurns(), searchParams]);
  return <NewIssueForm repos={newIssueRepos(repos, results)} initialRepo={typeof repo === "string" ? repo : undefined} />;
}
