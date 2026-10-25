import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { TurnSection } from "@/components/TurnSection";
import { findWatchedRepo, getWatchedRepos } from "@/lib/config";
import { loadTurns } from "@/lib/loadTurns";
import { filterTurnItems } from "@/lib/turn";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const watched = findWatchedRepo(owner, repo, getWatchedRepos());
  if (!watched) notFound();

  const { results, items, now } = await loadTurns();
  const errors = results.filter(
    (result) =>
      !result.ok && result.owner === watched.owner && result.repo === watched.repo,
  );

  return (
    <>
      <Header kind="repo" owner={watched.owner} repo={watched.repo} />
      <main className="content">
        <TurnSection
          items={filterTurnItems(items, watched.owner, watched.repo)}
          errors={errors}
          now={now}
          scope="repo"
        />
        <section className="section">
          <h2 className="section-title">パイプライン</h2>
        </section>
      </main>
    </>
  );
}
