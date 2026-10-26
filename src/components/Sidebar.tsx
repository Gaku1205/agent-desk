import { signOut } from "@/lib/auth";
import { getWatchedRepos } from "@/lib/config";
import { loadTurns } from "@/lib/loadTurns";
import { countTurnItems } from "@/lib/turn";
import { SidebarFrame } from "./SidebarFrame";
import { SettingsLink, SidebarNav } from "./SidebarNav";
import { SyncControl } from "./SyncControl";

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
    <SidebarFrame>
      <p className="sidebar-title mono">agent-desk</p>
      <SidebarNav repos={repos} counts={counts} />
      <SettingsLink />

      <div className="sidebar-footer">
        <SyncControl />
        <div className="sidebar-footer-row">
          <span className="sidebar-user mono">{login}</span>
          <form action={logout}>
            <button type="submit" className="logout-button">
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </SidebarFrame>
  );
}
