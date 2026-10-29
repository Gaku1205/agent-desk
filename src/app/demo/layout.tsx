import { connection } from "next/server";
import { DemoShell } from "@/components/DemoShell";
import { DemoTopBar } from "@/components/DemoTopBar";
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
      <DemoTopBar />
      {children}
    </DemoShell>
  );
}
