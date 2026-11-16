import { notFound } from "next/navigation";
import { loadStepLog } from "@/app/actions";
import { Desk } from "@/components/Desk";
import { getSignedInLogin } from "@/lib/auth";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { findWatchedRepo } from "@/lib/config";
import { loadTurns } from "@/lib/loadTurns";
import { newIssueRepos } from "@/lib/newIssue";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems, filterTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { logout } from "../../../logout";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const { repos } = await loadWatchedRepos();
  const watched = findWatchedRepo(owner, repo, repos);
  if (!watched) notFound();

  const { results, items, now, addedNotices } = await loadTurns();
  const same = (o: string, r: string) =>
    o.toLowerCase() === watched.owner.toLowerCase() && r.toLowerCase() === watched.repo.toLowerCase();

  return (
    <Desk
      items={filterTurnItems(items, watched.owner, watched.repo)}
      messages={buildConversation(results, buildTrailEvents(results, now, watched), now, watched)}
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
      addedNotices={addedNotices.filter((notice) => same(notice.owner, notice.repo))}
      nav={{
        repos,
        counts: countTurnItems(items),
        runningCounts: countRunningPipelineRows(results, now),
        login: (await getSignedInLogin()) ?? undefined,
        logout,
      }}
      newIssueRepos={newIssueRepos(repos, results)}
      loadStepLog={loadStepLog}
    />
  );
}
