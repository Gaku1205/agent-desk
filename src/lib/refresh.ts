import type { RepoResult } from "./github/types";
import { getIssueStatus, shouldShowIssue } from "./status";

/** AIの番の作業があるときに自動で取り直す間隔（docs/spec.md の「更新」） */
export const BUSY_REFRESH_INTERVAL_MS = 10_000;
/** AIの番の作業が無いときに自動で取り直す間隔 */
export const IDLE_REFRESH_INTERVAL_MS = 60_000;

/** 全監視リポジトリの判定結果に、AIの番の作業（`turn === "ai"`）が1つでもあるか */
export function hasAiTurnWork(results: RepoResult[], now: Date): boolean {
  return results.some(
    (result) =>
      result.ok &&
      result.data.issues.some(
        (issue) =>
          shouldShowIssue(issue, result.data.pulls) &&
          getIssueStatus(issue, result.data, now).turn === "ai",
      ),
  );
}

/** 即時反映がつながっている間の、AIの番の作業があるときの間隔 */
export const LIVE_BUSY_REFRESH_INTERVAL_MS = 60_000;
/** 即時反映がつながっている間の、AIの番の作業が無いときの間隔 */
export const LIVE_IDLE_REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * 自動で取り直す間隔：AIの番の作業があれば10秒、無ければ60秒。
 * 即時反映がつながっている間（`live`）は、それぞれ60秒・5分にゆるめる
 */
export function getRefreshIntervalMs(hasAiWork: boolean, live = false): number {
  if (live) return hasAiWork ? LIVE_BUSY_REFRESH_INTERVAL_MS : LIVE_IDLE_REFRESH_INTERVAL_MS;
  return hasAiWork ? BUSY_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;
}

/** 速い更新（10秒ごと）の間か。同期の横の点を光らせるかどうかに使う */
export function isFastRefresh(intervalMs: number): boolean {
  return intervalMs === BUSY_REFRESH_INTERVAL_MS;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 同期の時刻：日本時間の `15:42:10` */
export function formatSyncTime(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(11, 19);
}

/** 自動更新が見るタブの情報（`document` の一部） */
export type VisibilitySource = {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

/**
 * 一定の間隔で `refresh` を呼ぶ。タブが非表示の間は止め、表示に戻ったらすぐ1回取り直して数え直す。
 * 戻り値は止める関数
 */
export function startAutoRefresh(options: {
  refresh: () => void;
  source: VisibilitySource;
  intervalMs?: number;
}): () => void {
  const { refresh, source, intervalMs = IDLE_REFRESH_INTERVAL_MS } = options;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    timer = setInterval(refresh, intervalMs);
  };
  const onVisibilityChange = () => {
    if (source.hidden) {
      stop();
    } else {
      refresh();
      start();
    }
  };

  if (!source.hidden) start();
  source.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stop();
    source.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/** 即時反映で「取り直して」を受けてから、実際に取り直すまで待つ時間。この間に来た分は1回にまとめる */
export const LIVE_REFRESH_DEBOUNCE_MS = 1_000;

/** 即時反映のSSEの接続（`EventSource` の一部） */
export type LiveEventSource = {
  addEventListener(type: "ready" | "refresh" | "error", listener: () => void): void;
  close(): void;
};

/**
 * 即時反映（docs/spec.md の「即時反映」）につなぐ。
 * `ready` で「つながっている」、`error` で「切れた」を知らせる。`refresh` を受けたら、最初の1通から
 * `debounceMs` 待って1回だけ `refresh` を呼ぶ。つなぎ直したときも1回取り直す。タブが非表示の間は取り直さない。
 * 戻り値は止める関数
 */
export function startLiveRefresh(options: {
  open: () => LiveEventSource;
  refresh: () => void;
  onConnectedChange: (connected: boolean) => void;
  source: Pick<VisibilitySource, "hidden">;
  debounceMs?: number;
}): () => void {
  const { open, refresh, onConnectedChange, source, debounceMs = LIVE_REFRESH_DEBOUNCE_MS } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connectedOnce = false;

  const schedule = () => {
    if (source.hidden || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!source.hidden) refresh();
    }, debounceMs);
  };

  const live = open();
  live.addEventListener("ready", () => {
    // つなぎ直したときは、切れていた間の変化を取りこぼさないよう取り直す
    if (connectedOnce) schedule();
    connectedOnce = true;
    onConnectedChange(true);
  });
  live.addEventListener("refresh", schedule);
  live.addEventListener("error", () => onConnectedChange(false));

  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    live.close();
  };
}
