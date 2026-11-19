import { DemoNewIssue } from "@/components/DemoPages";

export const metadata = { title: "Issueを書く · デモ" };

export default async function DemoNewIssuePage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  return <DemoNewIssue initialRepo={typeof repo === "string" ? repo : undefined} />;
}
