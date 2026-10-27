"use client";

import { useEffect, useState } from "react";
import { formatSyncTime, getDisplayedSyncTime } from "@/lib/refresh";
import { useShell } from "./AppShell";
import sidebarStyles from "./Sidebar.module.css";
import styles from "./SyncControl.module.css";

/** 今の時刻。`active` の間だけ1秒ごとに進める。タブが非表示の間は進めず、表示に戻ったらすぐ今にする */
function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), 1000);
    };
    const onVisibilityChange = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);

  return now;
}

/**
 * サイドバーの下の1行目：同期の時刻（即時反映がつながっている間は現在時刻を1秒ごとに進め、切れたら最後に取り直した時刻。更新中は点が脈打ち、速い更新の間は点が明滅し、
 * 即時反映がつながっている間は点が点灯して「即時」を出す）と更新ボタン
 */
export function SyncControl() {
  const { syncedAt, refreshing, fastRefresh, live, refresh } = useShell();
  const now = useNow(live);

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
        同期 {formatSyncTime(getDisplayedSyncTime(live, syncedAt, now))}
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
