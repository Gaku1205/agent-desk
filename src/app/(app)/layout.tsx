import { AppShell } from "@/components/AppShell";
import { LoginScreen } from "@/components/LoginScreen";
import { TopBar } from "@/components/TopBar";
import { getSignedInLogin } from "@/lib/auth";
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

  const { repos } = await loadWatchedRepos();

  return (
    <AppShell
      initialSyncedAt={syncedAt.toISOString()}
      refreshIntervalMs={loaded.refreshPlan.intervalMs}
      resumeAt={loaded.refreshPlan.resumeAt}
      changeRepos={loaded.changeWatch.changeRepos}
      needsIntervalRefresh={loaded.changeWatch.needsIntervalRefresh}
    >
      <TopBar
        repos={repos}
        counts={countTurnItems(loaded.items)}
        runningCounts={countRunningPipelineRows(loaded.results, loaded.now)}
        login={login}
        logout={logout}
      />
      {children}
    </AppShell>
  );
}
