import { Desk } from "@/components/Desk";
import { buildTrailEvents } from "@/lib/events";
import { buildFlowNodes } from "@/lib/flow/nodes";
import { loadTurns } from "@/lib/loadTurns";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { buildWatchdogNotices } from "@/lib/watchdogState";

export default async function Home() {
  const { results, items, now } = await loadTurns();
  const { repos } = await loadWatchedRepos();
  const counts = countTurnItems(items);

  return (
    <Desk
      nodes={buildFlowNodes(results, now)}
      items={items}
      events={buildTrailEvents(results, now)}
      now={now.toISOString()}
      scope={{
        kind: "all",
        repos: repos.map(({ owner, repo }) => ({ repo, count: counts.byRepo[`${owner}/${repo}`.toLowerCase()] ?? 0 })),
      }}
      errors={results.flatMap((result) => (result.ok ? [] : [{ repo: `${result.owner}/${result.repo}`, message: result.error.message }]))}
      notices={buildWatchdogNotices(results, now)}
    />
  );
}
