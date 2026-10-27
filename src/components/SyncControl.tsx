"use client";

import { formatSyncTime } from "@/lib/refresh";
import { useShell } from "./AppShell";
import sidebarStyles from "./Sidebar.module.css";
import styles from "./SyncControl.module.css";

/**
 * サイドバーの下の1行目：同期の時刻（更新中は点が脈打ち、速い更新の間は点が明滅し、
 * 即時反映がつながっている間は点が点灯して「即時」を出す）と更新ボタン
 */
export function SyncControl() {
  const { syncedAt, refreshing, fastRefresh, live, refresh } = useShell();

  return (
    <div className={sidebarStyles.footerRow}>
      <span className={`${styles.sync} mono`}>
        <span
          className={styles.dot}
          data-busy={refreshing ? "true" : undefined}
          data-fast={fastRefresh ? "true" : undefined}
          data-live={live ? "true" : undefined}
          aria-hidden="true"
        />
        同期 {formatSyncTime(syncedAt)}
        {live && (
          <span className={styles.live} title="GitHubの変化をすぐ受け取っています">
            即時
          </span>
        )}
      </span>
      <button
        type="button"
        className={styles.refreshButton}
        disabled={refreshing}
        aria-busy={refreshing}
        onClick={refresh}
      >
        更新
      </button>
    </div>
  );
}
