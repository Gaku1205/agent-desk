import { EventSection } from "@/components/EventSection";
import { Header } from "@/components/Header";
import { RunningPipelineSection } from "@/components/RunningPipelineSection";
import { TurnSection } from "@/components/TurnSection";
import { WaitingPipelineSection } from "@/components/WaitingPipelineSection";
import { WatchdogNotices } from "@/components/WatchdogNotices";
import { buildRecentEvents } from "@/lib/events";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { loadTurns } from "@/lib/loadTurns";
import { buildRunningPipelineRows } from "@/lib/runningPipeline";
import { buildWaitingPipelineRows } from "@/lib/waitingPipeline";

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
        <WaitingPipelineSection rows={buildWaitingPipelineRows(results, now)} />
        <RunningPipelineSection rows={buildRunningPipelineRows(results, now)} />
        <EventSection events={buildRecentEvents(results, now)} now={now} />
      </main>
    </>
  );
}
