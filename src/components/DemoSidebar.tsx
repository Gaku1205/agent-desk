"use client";

import Link from "next/link";
import { DEMO_APP_REPO_URL, DEMO_BASE_PATH, DEMO_REPOS } from "@/lib/demo/data";
import { countTurnItems } from "@/lib/turn";
import { useDemoState } from "./DemoContext";
import styles from "./Sidebar.module.css";
import { SidebarFrame } from "./SidebarFrame";
import { SettingsLink, SidebarNav } from "./SidebarNav";
import { SyncControl } from "./SyncControl";

/** デモのサイドバー。本物と同じ部品で、リンクの頭が `/demo`。ユーザー名の行の代わりに、スマホでは帯の残りのリンクを出す */
export function DemoSidebar() {
  const { items } = useDemoState();

  return (
    <SidebarFrame belowBanner>
      <p className={`${styles.title} mono`}>agent-desk</p>
      <SidebarNav repos={DEMO_REPOS} counts={countTurnItems(items)} basePath={DEMO_BASE_PATH} />
      <SettingsLink basePath={DEMO_BASE_PATH} />

      <div className={styles.footer}>
        <SyncControl />
        <div className={`${styles.footerRow} ${styles.demoLinks}`}>
          <a className={styles.logoutButton} href={DEMO_APP_REPO_URL} target="_blank" rel="noreferrer">
            GitHubで見る ↗
          </a>
          <Link className={styles.logoutButton} href="/">
            ログイン
          </Link>
        </div>
      </div>
    </SidebarFrame>
  );
}
