import { DemoDashboard } from "@/components/DemoPages";
import { parsePeriodParam } from "@/lib/dashboard/period";

export const metadata = { title: "Dashboard · デモ" };

export default async function DemoDashboardPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const { period } = await searchParams;
  return <DemoDashboard initialPeriod={parsePeriodParam(period)} />;
}
