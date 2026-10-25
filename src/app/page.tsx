import { Header } from "@/components/Header";

export default function Home() {
  return (
    <>
      <Header kind="home" />
      <main className="content">
        <section className="section">
          <h2 className="section-title">あなたの番</h2>
        </section>
        <section className="section">
          <h2 className="section-title">最近の出来事</h2>
        </section>
      </main>
    </>
  );
}
