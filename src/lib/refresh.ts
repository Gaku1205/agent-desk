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

/** 自動で取り直す間隔：AIの番の作業があれば10秒、無ければ60秒 */
export function getRefreshIntervalMs(hasAiWork: boolean): number {
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

/** `R` キーの判定に必要な、キー入力の情報 */
export type RefreshKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  /** キーを受けた要素のタグ名（大文字）。無ければ空文字 */
  targetTag: string;
  targetEditable: boolean;
};

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** `R` キーで更新してよいか（入力欄にフォーカスがあるときや、他のキーとの組み合わせでは反応しない） */
export function isRefreshKey(event: RefreshKeyEvent): boolean {
  if (event.key !== "r" && event.key !== "R") return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.repeat || event.isComposing) return false;
  if (TEXT_ENTRY_TAGS.has(event.targetTag) || event.targetEditable) return false;
  return true;
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
