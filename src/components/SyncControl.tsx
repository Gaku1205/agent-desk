"use client";

import { formatSyncTime } from "@/lib/refresh";
import { useShell } from "./AppShell";

/** サイドバーの下の1行目：同期の時刻（更新中は点が脈打ち、速い更新の間は点が明滅する）と更新ボタン */
export function SyncControl() {
  const { syncedAt, refreshing, fastRefresh, refresh } = useShell();

  return (
    <div className="sidebar-footer-row">
      <span className="sidebar-sync mono">
        <span
          className="sync-dot"
          data-busy={refreshing ? "true" : undefined}
          data-fast={fastRefresh ? "true" : undefined}
          aria-hidden="true"
        />
        同期 {formatSyncTime(syncedAt)}
      </span>
      <button
        type="button"
        className="refresh-button"
        disabled={refreshing}
        aria-busy={refreshing}
        onClick={refresh}
      >
        更新 <kbd className="mono">R</kbd>
      </button>
    </div>
  );
}
