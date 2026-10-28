import type { RepoResult } from "./github/types";
import { getIssueStatus, shouldShowIssue } from "./status";

/** AIの番の作業があるときに自動で取り直す間隔（docs/spec.md の「更新」） */
export const BUSY_REFRESH_INTERVAL_MS = 10_000;
/** AIの番の作業が無いときに自動で取り直す間隔 */
export const IDLE_REFRESH_INTERVAL_MS = 30_000;
/** 回数制限の残りが少ない（LOW 以上 NORMAL 未満）ときに自動で取り直す間隔 */
export const LOW_REMAINING_REFRESH_INTERVAL_MS = 60_000;
/** 残りがこれ以上なら普段の間隔 */
export const NORMAL_REMAINING_THRESHOLD = 1_500;
/** 残りがこれ未満なら、回復する時刻まで自動では取り直さない */
export const PAUSE_REMAINING_THRESHOLD = 500;

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

/** 自動で取り直す間隔：AIの番の作業があれば10秒、無ければ30秒 */
export function getRefreshIntervalMs(hasAiWork: boolean): number {
  return hasAiWork ? BUSY_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;
}

/** 自動更新の決め方。`intervalMs` が null のときは、`resumeAt` まで自動では取り直さない */
export type AutoRefreshPlan =
  | { intervalMs: number; resumeAt: null }
  | { intervalMs: null; resumeAt: Date };

/**
 * 回数制限の残りに応じた、自動で取り直す間隔（docs/spec.md の「更新」）。
 * `remaining` が null（不明）か、回復する時刻 `resetAt`（UNIX秒）を過ぎていれば、残りは古いので普段の間隔
 */
export function getAutoRefreshPlan(input: {
  hasAiWork: boolean;
  remaining: number | null;
  resetAt: number | null;
  now: Date;
}): AutoRefreshPlan {
  const { hasAiWork, remaining, resetAt, now } = input;
  const usual: AutoRefreshPlan = { intervalMs: getRefreshIntervalMs(hasAiWork), resumeAt: null };
  if (remaining === null) return usual;
  const resetMs = resetAt === null ? null : resetAt * 1000;
  if (resetMs !== null && now.getTime() >= resetMs) return usual;
  if (remaining >= NORMAL_REMAINING_THRESHOLD) return usual;
  if (remaining >= PAUSE_REMAINING_THRESHOLD) {
    return { intervalMs: LOW_REMAINING_REFRESH_INTERVAL_MS, resumeAt: null };
  }
  // 回復する時刻が分からないときは止められないので、60秒ごとにする
  if (resetMs === null) return { intervalMs: LOW_REMAINING_REFRESH_INTERVAL_MS, resumeAt: null };
  return { intervalMs: null, resumeAt: new Date(resetMs) };
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

/** 回復する時刻：日本時間の `15:42`（秒は落とす）。`resetAt` はUNIX秒 */
export function formatResetTime(resetAt: number): string {
  return new Date(resetAt * 1000 + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/**
 * 同期の表示に出す時刻：最後に取り直した時刻（docs/spec.md の「更新」）。
 * 現在時刻で進めると、取り直せていない古い画面が最新に見えてしまう
 */
export function getDisplayedSyncTime(syncedAt: Date): Date {
  return syncedAt;
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

/**
 * 自動更新を止めている間、`resumeAt` になったら `refresh` を1回呼ぶ。
 * その時刻にタブが非表示なら、表示に戻ったときに呼ぶ。取り直したあとの間隔はサーバーが決め直す。
 * 戻り値は止める関数
 */
export function startResumeRefresh(options: {
  refresh: () => void;
  source: VisibilitySource;
  resumeAt: Date;
  now?: () => Date;
}): () => void {
  const { refresh, source, resumeAt, now = () => new Date() } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingForVisible = false;

  const onVisibilityChange = () => {
    if (source.hidden) return;
    source.removeEventListener("visibilitychange", onVisibilityChange);
    waitingForVisible = false;
    refresh();
  };
  const onTime = () => {
    timer = null;
    if (source.hidden) {
      waitingForVisible = true;
      source.addEventListener("visibilitychange", onVisibilityChange);
      return;
    }
    refresh();
  };

  timer = setTimeout(onTime, Math.max(0, resumeAt.getTime() - now().getTime()));

  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (waitingForVisible) source.removeEventListener("visibilitychange", onVisibilityChange);
    waitingForVisible = false;
  };
}
