import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LoginScreen } from "@/components/LoginScreen";
import { NavProvider } from "@/components/NavContext";
import { ParallelProvider } from "@/components/ParallelContext";
import { TopBar } from "@/components/TopBar";
import { getSignedInLogin } from "@/lib/auth";
import { isAuthExpired, SESSION_EXPIRED_PATH } from "@/lib/authExpired";
import { loadTurns } from "@/lib/loadTurns";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { logout } from "./logout";

/** 本物の画面。ログインしていなければ、どのURLでもログインボタンだけを出す */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const login = await getSignedInLogin();
  const loaded = login ? await loadTurns() : null;
  const syncedAt = loaded?.now ?? null;

  if (!login || !loaded || !syncedAt) return <LoginScreen />;

  // トークンが使えなくなった（401）ら、ログアウトして理由つきでログインの画面へ。
  // 描画中は Cookie を消せないので、Route Handler に任せる
  if (isAuthExpired(loaded.results)) redirect(SESSION_EXPIRED_PATH);

  const { repos } = await loadWatchedRepos();

  return (
    <AppShell
      initialSyncedAt={syncedAt.toISOString()}
      refreshIntervalMs={loaded.refreshPlan.intervalMs}
      resumeAt={loaded.refreshPlan.resumeAt}
      changeRepos={loaded.changeWatch.changeRepos}
      appliedChangeMarks={loaded.changeWatch.appliedMarks}
      needsIntervalRefresh={loaded.changeWatch.needsIntervalRefresh}
      graceRefreshAt={loaded.graceRefreshAt}
    >
      <ParallelProvider>
        <TopBar
          repos={repos}
          counts={countTurnItems(loaded.items)}
          runningCounts={countRunningPipelineRows(loaded.results, loaded.now)}
          login={login}
          logout={logout}
        />
        <NavProvider
          value={{
            repos,
            counts: countTurnItems(loaded.items),
            runningCounts: countRunningPipelineRows(loaded.results, loaded.now),
            login,
            logout,
          }}
        >
          {children}
        </NavProvider>
      </ParallelProvider>
    </AppShell>
  );
}
