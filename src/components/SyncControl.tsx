"use client";

import { formatSyncTime, getDisplayedSyncTime } from "@/lib/refresh";
import { useShell } from "./AppShell";
import sidebarStyles from "./Sidebar.module.css";
import styles from "./SyncControl.module.css";

/**
 * サイドバーの下の1行目：同期の時刻（最後に取り直した時刻。更新中は点が脈打ち、速い更新の間は点が明滅する）と更新ボタン
 */
export function SyncControl() {
  const { syncedAt, refreshing, fastRefresh, refresh } = useShell();

  return (
    <div className={sidebarStyles.footerRow}>
      <span className={`${styles.sync} mono`}>
        <span
          className={styles.dot}
          data-busy={refreshing ? "true" : undefined}
          data-fast={fastRefresh ? "true" : undefined}
          aria-hidden="true"
        />
        同期 {formatSyncTime(getDisplayedSyncTime(syncedAt))}
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
