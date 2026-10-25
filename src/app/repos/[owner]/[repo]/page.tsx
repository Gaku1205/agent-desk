import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { findWatchedRepo, getWatchedRepos } from "@/lib/config";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const watched = findWatchedRepo(owner, repo, getWatchedRepos());
  if (!watched) notFound();

  return (
    <>
      <Header kind="repo" owner={watched.owner} repo={watched.repo} />
      <main className="content">
        <section className="section">
          <h2 className="section-title">あなたの番</h2>
        </section>
        <section className="section">
          <h2 className="section-title">パイプライン</h2>
        </section>
      </main>
    </>
  );
}
