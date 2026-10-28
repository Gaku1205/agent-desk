import { AppShell } from "@/components/AppShell";
import { LoginScreen } from "@/components/LoginScreen";
import { Sidebar } from "@/components/Sidebar";
import { getSignedInLogin } from "@/lib/auth";
import { loadTurns } from "@/lib/loadTurns";

/** 本物の画面。ログインしていなければ、どのURLでもログインボタンだけを出す */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const login = await getSignedInLogin();
  const loaded = login ? await loadTurns() : null;
  const syncedAt = loaded?.now ?? null;

  if (!login || !syncedAt) return <LoginScreen />;

  return (
    <AppShell
      initialSyncedAt={syncedAt.toISOString()}
      refreshIntervalMs={loaded?.refreshPlan.intervalMs ?? null}
      resumeAt={loaded?.refreshPlan.resumeAt ?? null}
    >
      <div className="app">
        <Sidebar login={login} />
        <div className="main">{children}</div>
      </div>
    </AppShell>
  );
}
