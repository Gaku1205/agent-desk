import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoRepo } from "@/components/DemoPages";
import { findWatchedRepo } from "@/lib/config";
import { DEMO_AUTO_ADD_REPO, DEMO_REPOS } from "@/lib/demo/data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { repo } = await params;
  return { title: `${repo} · デモ` };
}

export default async function DemoRepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  // 自動で足すリポジトリ（morning-card）は、足したかを画面（DemoRepo）で確かめる
  const watched = findWatchedRepo(owner, repo, [...DEMO_REPOS, DEMO_AUTO_ADD_REPO]);
  if (!watched) notFound();
  return <DemoRepo owner={watched.owner} repo={watched.repo} />;
}
