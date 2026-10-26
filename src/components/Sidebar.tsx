import { signOut } from "@/lib/auth";
import { loadTurns } from "@/lib/loadTurns";
import { countTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import styles from "./Sidebar.module.css";
import { SidebarFrame } from "./SidebarFrame";
import { SettingsLink, SidebarNav } from "./SidebarNav";
import { SyncControl } from "./SyncControl";

type Props = {
  login: string;
};

export async function Sidebar({ login }: Props) {
  const { repos } = await loadWatchedRepos();
  const { items } = await loadTurns();
  const counts = countTurnItems(items);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <SidebarFrame>
      <p className={`${styles.title} mono`}>agent-desk</p>
      <SidebarNav repos={repos} counts={counts} />
      <SettingsLink />

      <div className={styles.footer}>
        <SyncControl />
        <div className={styles.footerRow}>
          <span className={`${styles.user} mono`}>{login}</span>
          <form action={logout}>
            <button type="submit" className={styles.logoutButton}>
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </SidebarFrame>
  );
}
