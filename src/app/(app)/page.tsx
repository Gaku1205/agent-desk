import { EventSection } from "@/components/EventSection";
import { Header } from "@/components/Header";
import { TurnSection } from "@/components/TurnSection";
import { buildRecentEvents } from "@/lib/events";
import { loadTurns } from "@/lib/loadTurns";

export default async function Home() {
  const { results, items, now } = await loadTurns();

  return (
    <>
      <Header kind="home" />
      <main className="content">
        <TurnSection
          items={items}
          errors={results.filter((result) => !result.ok)}
          now={now}
          scope="all"
        />
        <EventSection events={buildRecentEvents(results, now)} now={now} />
      </main>
    </>
  );
}
