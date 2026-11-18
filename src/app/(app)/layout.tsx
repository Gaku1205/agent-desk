import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AppTopBar } from "@/components/AppTopBar";
import { LoginScreen } from "@/components/LoginScreen";
import { NavProvider } from "@/components/NavContext";
import { ParallelProvider } from "@/components/ParallelContext";
import { getSignedInLogin } from "@/lib/auth";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { LayoutStream } from "./LayoutStream";
import { logout } from "./logout";

const NO_COUNTS = { byRepo: {} };

/** 本物の画面。ログインしていなければ、どのURLでもログインボタンだけを出す */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const login = await getSignedInLogin();
  if (!login) return <LoginScreen />;

  const { repos } = await loadWatchedRepos();
  const renderedAt = new Date().toISOString();

  // 全リポジトリの読み込み（件数・自動更新の計画）は待たない。`LayoutStream` が Suspense で後から流す。
  // 取り直しのたびに境界の key を替える：同じ境界のままだと、トランジションの中では React が
  // 新しい木がそろうまで前の画面を出し続け、中央が先に入れ替わらないため
  return (
    <AppShell initialSyncedAt={renderedAt}>
      <ParallelProvider>
        <NavProvider base={{ repos, counts: NO_COUNTS, runningCounts: NO_COUNTS, login, logout }}>
          <AppTopBar />
          <Suspense key={renderedAt} fallback={null}>
            <LayoutStream />
          </Suspense>
          {children}
        </NavProvider>
      </ParallelProvider>
    </AppShell>
  );
}
