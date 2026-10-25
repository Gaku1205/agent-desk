import { signOut } from "@/lib/auth";
import { getWatchedRepos } from "@/lib/config";
import { loadTurns } from "@/lib/loadTurns";
import { countTurnItems } from "@/lib/turn";
import { SidebarNav } from "./SidebarNav";

type Props = {
  login: string;
};

export async function Sidebar({ login }: Props) {
  const repos = getWatchedRepos();
  const { items } = await loadTurns();
  const counts = countTurnItems(items);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <aside className="sidebar">
      <p className="sidebar-title mono">agent-desk</p>
      <SidebarNav repos={repos} counts={counts} />

      <div className="sidebar-footer">
        <div className="sidebar-footer-row">
          <span className="sidebar-sync mono">同期 --:--:--</span>
          <button type="button" className="refresh-button" disabled>
            更新 <kbd className="mono">R</kbd>
          </button>
        </div>
        <div className="sidebar-footer-row">
          <span className="sidebar-user mono">{login}</span>
          <form action={logout}>
            <button type="submit" className="logout-button">
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
