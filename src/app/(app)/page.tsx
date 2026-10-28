import { EventSection } from "@/components/EventSection";
import { Header } from "@/components/Header";
import { RunningPipelineSection } from "@/components/RunningPipelineSection";
import { TurnSection } from "@/components/TurnSection";
import { WatchdogNotices } from "@/components/WatchdogNotices";
import { buildRecentEvents } from "@/lib/events";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { loadTurns } from "@/lib/loadTurns";
import { buildRunningPipelineRows } from "@/lib/runningPipeline";

export default async function Home() {
  const { results, items, now } = await loadTurns();

  return (
    <>
      <Header kind="home" />
      <main className="content">
        <WatchdogNotices notices={buildWatchdogNotices(results, now)} showRepo />
        <TurnSection
          items={items}
          errors={results.filter((result) => !result.ok)}
          now={now}
          scope="all"
        />
        <RunningPipelineSection rows={buildRunningPipelineRows(results, now)} />
        <EventSection events={buildRecentEvents(results, now)} now={now} />
      </main>
    </>
  );
}
