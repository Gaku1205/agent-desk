import { connection } from "next/server";
import { DemoBanner } from "@/components/DemoBanner";
import { DemoShell } from "@/components/DemoShell";
import { DemoSidebar } from "@/components/DemoSidebar";
import { getDemoNow } from "@/lib/demo/now";

/** デモ（ログイン不要）。サンプルのデータだけを使い、GitHub には一切問い合わせない */
export default async function DemoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 「今」をリクエストごとに決める（ビルドのときの時刻で固めない）
  await connection();
  const now = getDemoNow();

  return (
    <DemoShell initialNow={now.toISOString()}>
      <DemoBanner />
      <div className="app demo-app">
        <DemoSidebar />
        <div className="main">{children}</div>
      </div>
    </DemoShell>
  );
}
