import { Header } from "@/components/Header";
import { TurnSection } from "@/components/TurnSection";
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
        <section className="section">
          <h2 className="section-title">最近の出来事</h2>
        </section>
      </main>
    </>
  );
}
