import { NewIssueForm } from "@/components/NewIssueForm";
import { Backdrop } from "@/components/Backdrop";
import { loadTurns } from "@/lib/loadTurns";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/** Issueを書く画面：監視しているリポジトリから選んで、1行のメモを書く */
export default async function NewIssuePage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const [{ repos }, { results }, { repo }] = await Promise.all([loadWatchedRepos(), loadTurns(), searchParams]);
  const rows = repos.map((watched) => {
    const found = results.find(
      (result) =>
        result.owner.toLowerCase() === watched.owner.toLowerCase() && result.repo.toLowerCase() === watched.repo.toLowerCase(),
    );
    return { name: `${watched.owner}/${watched.repo}`, template: !!found && found.ok && found.data.isTemplate === true };
  });
  return (
    <>
      <Backdrop />
      <NewIssueForm repos={rows} initialRepo={typeof repo === "string" ? repo : undefined} />
    </>
  );
}
