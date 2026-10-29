import { notFound } from "next/navigation";
import { Desk } from "@/components/Desk";
import { buildTrailEvents } from "@/lib/events";
import { buildFlowNodes } from "@/lib/flow/nodes";
import { findWatchedRepo } from "@/lib/config";
import { loadTurns } from "@/lib/loadTurns";
import { filterTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { buildWatchdogNotices } from "@/lib/watchdogState";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const watched = findWatchedRepo(owner, repo, (await loadWatchedRepos()).repos);
  if (!watched) notFound();

  const { results, items, now } = await loadTurns();
  const same = (o: string, r: string) =>
    o.toLowerCase() === watched.owner.toLowerCase() && r.toLowerCase() === watched.repo.toLowerCase();

  return (
    <Desk
      nodes={buildFlowNodes(results, now, watched)}
      items={filterTurnItems(items, watched.owner, watched.repo)}
      events={buildTrailEvents(results, now, watched)}
      now={now.toISOString()}
      scope={{
        kind: "repo",
        owner: watched.owner,
        repo: watched.repo,
        githubUrl: `https://github.com/${watched.owner}/${watched.repo}`,
      }}
      errors={results.flatMap((result) =>
        result.ok || !same(result.owner, result.repo)
          ? []
          : [{ repo: `${result.owner}/${result.repo}`, message: result.error.message }],
      )}
      notices={buildWatchdogNotices(results, now).filter((notice) => same(notice.owner, notice.repo))}
    />
  );
}
