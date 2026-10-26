"use client";

import Link from "next/link";
import { DEMO_APP_REPO_URL, DEMO_BASE_PATH, DEMO_REPOS } from "@/lib/demo/data";
import { countTurnItems } from "@/lib/turn";
import { useDemoState } from "./DemoContext";
import { SidebarFrame } from "./SidebarFrame";
import { SettingsLink, SidebarNav } from "./SidebarNav";
import { SyncControl } from "./SyncControl";

/** デモのサイドバー。本物と同じ部品で、リンクの頭が `/demo`。ユーザー名の行の代わりに、スマホでは帯の残りのリンクを出す */
export function DemoSidebar() {
  const { items } = useDemoState();

  return (
    <SidebarFrame>
      <p className="sidebar-title mono">agent-desk</p>
      <SidebarNav repos={DEMO_REPOS} counts={countTurnItems(items)} basePath={DEMO_BASE_PATH} />
      <SettingsLink basePath={DEMO_BASE_PATH} />

      <div className="sidebar-footer">
        <SyncControl />
        <div className="sidebar-footer-row demo-menu-links">
          <a className="logout-button" href={DEMO_APP_REPO_URL} target="_blank" rel="noreferrer">
            GitHubで見る ↗
          </a>
          <Link className="logout-button" href="/">
            ログイン
          </Link>
        </div>
      </div>
    </SidebarFrame>
  );
}
