import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { PipelineTable } from "@/components/PipelineTable";
import { TurnSection } from "@/components/TurnSection";
import { WatchdogNotices } from "@/components/WatchdogNotices";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { findWatchedRepo } from "@/lib/config";
import { loadTurns } from "@/lib/loadTurns";
import { buildPipelineRows } from "@/lib/pipeline";
import { filterTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const watched = findWatchedRepo(owner, repo, (await loadWatchedRepos()).repos);
  if (!watched) notFound();

  const { results, items, now } = await loadTurns();
  const errors = results.filter(
    (result) =>
      !result.ok && result.owner === watched.owner && result.repo === watched.repo,
  );

  const repoResult = results.find(
    (result) =>
      result.ok &&
      result.owner.toLowerCase() === watched.owner.toLowerCase() &&
      result.repo.toLowerCase() === watched.repo.toLowerCase(),
  );
  const rows = repoResult?.ok ? buildPipelineRows(repoResult.data, now) : [];

  return (
    <>
      <Header kind="repo" owner={watched.owner} repo={watched.repo} />
      <main className="content">
        <WatchdogNotices
          notices={buildWatchdogNotices(results, now).filter(
            (notice) =>
              notice.owner.toLowerCase() === watched.owner.toLowerCase() &&
              notice.repo.toLowerCase() === watched.repo.toLowerCase(),
          )}
          showRepo={false}
        />
        <TurnSection
          items={filterTurnItems(items, watched.owner, watched.repo)}
          errors={errors}
          now={now}
          scope="repo"
        />
        <PipelineTable rows={rows} repoName={watched.repo} />
      </main>
    </>
  );
}
