"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import { getSidebarSnapshot, subscribeSidebar, type DeskNav } from "./Desk";
import { PanelLeftIcon } from "./icons";
import styles from "./RepoList.module.css";
import { SideRepos } from "./TopBar";

/**
 * 新しいサービスを作る（`/new/service`）の枠：左のバー（ホーム・`/repos` と同じ `SideRepos`）と、中央の1本の列。
 * 畳むボタンも同じ（docs/spec.md の「新しいサービスを作る」）
 */
export function NewServiceFrame({ nav, children }: { nav: DeskNav; children: ReactNode }) {
  const sideCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const toggleSide = useCallback(() => {
    const next = !getSidebarSnapshot();
    applySidebar(next, document.documentElement);
    writeSidebarCollapsed(getBrowserStorage(), next);
  }, []);

  return (
    <div className={styles.panes} data-panes="">
      <button
        type="button"
        className={styles.sideToggle}
        onClick={toggleSide}
        aria-expanded={!sideCollapsed}
        aria-controls="side-repos"
        aria-label={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
        title={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
      >
        <PanelLeftIcon />
      </button>
      <div className={styles.side} id="side-repos" inert={sideCollapsed}>
        <SideRepos {...nav} />
      </div>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
