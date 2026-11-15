import { Desk } from "@/components/Desk";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { loadTurns } from "@/lib/loadTurns";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { buildWatchdogNotices } from "@/lib/watchdogState";

export default async function Home() {
  const { results, items, now } = await loadTurns();
  const { repos } = await loadWatchedRepos();

  return (
    <Desk
      items={items}
      messages={buildConversation(results, buildTrailEvents(results, now), now)}
      now={now.toISOString()}
      scope={{ kind: "all", repoCount: repos.length }}
      errors={results.flatMap((result) => (result.ok ? [] : [{ repo: `${result.owner}/${result.repo}`, message: result.error.message }]))}
      notices={buildWatchdogNotices(results, now)}
    />
  );
}
