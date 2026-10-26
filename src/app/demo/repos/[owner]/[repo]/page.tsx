import { notFound } from "next/navigation";
import { DemoRepo } from "@/components/DemoPages";
import { findWatchedRepo } from "@/lib/config";
import { DEMO_REPOS } from "@/lib/demo/data";

export default async function DemoRepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const watched = findWatchedRepo(owner, repo, DEMO_REPOS);
  if (!watched) notFound();
  return <DemoRepo owner={watched.owner} repo={watched.repo} />;
}
