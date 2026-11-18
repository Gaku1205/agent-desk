import { DemoNewIssue } from "@/components/DemoPages";

export default async function DemoNewIssuePage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  return <DemoNewIssue initialRepo={typeof repo === "string" ? repo : undefined} />;
}
