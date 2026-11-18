import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AppTopBar } from "@/components/AppTopBar";
import { LoginScreen } from "@/components/LoginScreen";
import { NavProvider } from "@/components/NavContext";
import { ParallelProvider } from "@/components/ParallelContext";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { LayoutStream, RepoStream } from "./LayoutStream";
import { logout } from "./logout";

const NO_COUNTS = { byRepo: {} };

/** 本物の画面。ログインしていなければ、どのURLでもログインボタンだけを出す */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const login = await getSignedInLogin();
  if (!login) return <LoginScreen />;

  const { repos } = await loadWatchedRepos();
  const token = await getGitHubToken();
  const renderedAt = new Date().toISOString();

  // 全リポジトリの読み込み（自動更新の計画・Issueを書く欄の一覧）は待たない。`LayoutStream` が Suspense で後から流す。
  // 件数は、リポジトリごとの境界（`RepoStream`）が、読み終えたリポジトリから順に流す。
  // 取り直しのたびに境界の key を替える：同じ境界のままだと、トランジションの中では React が
  // 新しい木がそろうまで前の画面を出し続け、中央が先に入れ替わらないため
  return (
    <AppShell initialSyncedAt={renderedAt}>
      <ParallelProvider>
        <NavProvider base={{ repos, counts: NO_COUNTS, runningCounts: NO_COUNTS, login, logout }}>
          <AppTopBar />
          <Suspense key={renderedAt} fallback={null}>
            <LayoutStream renderedAt={renderedAt} />
          </Suspense>
          {token &&
            repos.map((repo) => (
              <Suspense key={`${renderedAt}:${repo.owner}/${repo.repo}`} fallback={null}>
                <RepoStream token={token} repo={repo} renderedAt={renderedAt} />
              </Suspense>
            ))}
          {children}
        </NavProvider>
      </ParallelProvider>
    </AppShell>
  );
}
