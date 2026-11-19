import { formatEventTime } from "../events";
import type { RunEntry } from "./source";

/**
 * Slots & Queue の Background の Sleeping（寝ているだけの実行。今は目覚まし＝`Retry Timer`）と、
 * 見出しの `Actions jobs` の目盛り（docs/spec.md の「Slots & Queue」の「Background」）
 */

/** 目覚ましのワークフローの名前（`.github/workflows/retry-timer.yml` の `name`） */
export const RETRY_TIMER_NAME = "Retry Timer";
/** 目覚ましの実行の題名の始まり（`run-name: やり直しの目覚まし ${{ inputs.at }}`） */
export const RETRY_TIMER_TITLE = "やり直しの目覚まし ";
/** GitHub の無料プランの、同時に動かせるジョブの数（設定では変えない） */
export const ACTIONS_JOB_LIMIT = 20;
/** これより先に起きる物は `Long` */
export const LONG_SLEEP_MS = 45 * 60 * 1000;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 寝ているだけの実行か（目覚まし：名前が `Retry Timer`、または題名が `やり直しの目覚まし ` で始まる） */
export function isSleepingRun(run: { name?: string; displayTitle: string }): boolean {
  return run.name?.trim() === RETRY_TIMER_NAME || run.displayTitle.startsWith(RETRY_TIMER_TITLE);
}

/** 目覚ましの題名の unix 時刻（秒）を、起きる時刻（ミリ秒）にする。読めなければ null */
export function wakeAtFromTitle(title: string): number | null {
  if (!title.startsWith(RETRY_TIMER_TITLE)) return null;
  const match = title.slice(RETRY_TIMER_TITLE.length).trim().match(/^(\d{1,12})$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** 起きる時刻の早い順（時刻が読めない物は最後。同じなら key の順）。元の配列は変えない */
export function sortByWake<T extends Pick<RunEntry, "key" | "wakeAtMs">>(runs: readonly T[]): T[] {
  return [...runs].sort(
    (a, b) =>
      (a.wakeAtMs ?? Number.MAX_SAFE_INTEGER) - (b.wakeAtMs ?? Number.MAX_SAFE_INTEGER) || a.key.localeCompare(b.key),
  );
}

function jstDay(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 起きる時刻の表示：今日（日本時間）なら `14:41`、今日でなければ `11/20 14:41` */
export function wakeTimeText(wakeAtMs: number, now: Date): string {
  const time = formatEventTime(new Date(wakeAtMs).toISOString());
  if (jstDay(wakeAtMs) === jstDay(now.getTime())) return time;
  const [, month, date] = jstDay(wakeAtMs).split("-");
  return `${Number(month)}/${Number(date)} ${time}`;
}

/** `Long`：起きる時刻が「今」より45分より先 */
export function isLongSleep(wakeAtMs: number | null, now: Date): boolean {
  return wakeAtMs !== null && wakeAtMs - now.getTime() > LONG_SLEEP_MS;
}

/** `actions/runs/{run_id}/jobs` の返事の、`in_progress` のジョブの数。返事が読めなければ null */
export function countInProgressJobs(raw: unknown): number | null {
  const jobs = (raw as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return null;
  return jobs.filter((job) => (job as { status?: unknown } | null)?.status === "in_progress").length;
}

export type JobCell = "active" | "sleeping" | "free";

export type JobGauge = {
  /** 動いているジョブの数（寝ていない実行のジョブの合計。読めなかった実行は数えない） */
  active: number;
  /** 寝ているジョブの数（寝ている実行1つ＝1ジョブ） */
  sleeping: number;
  /** 動いている＋寝ている */
  total: number;
  limit: number;
  /** 20マス（動いている → 寝ている → 空き。20を超えたら20で打ち切り） */
  cells: JobCell[];
  /** `12/20` */
  text: string;
  /** 読み上げ：`Actions jobs 20のうち 動いている2・寝ている10` */
  label: string;
};

/** 見出しの目盛り：全リポジトリの実行（席にぶら下がる分も含む）から、ジョブの数を数える */
export function jobGauge(runs: readonly Pick<RunEntry, "sleeping" | "jobs">[], limit: number = ACTIONS_JOB_LIMIT): JobGauge {
  let active = 0;
  let sleeping = 0;
  for (const run of runs) {
    if (run.sleeping) sleeping += 1;
    else active += run.jobs ?? 0;
  }
  const total = active + sleeping;
  const cells: JobCell[] = [];
  for (let i = 0; i < limit; i += 1) {
    cells.push(i < active ? "active" : i < total ? "sleeping" : "free");
  }
  return {
    active,
    sleeping,
    total,
    limit,
    cells,
    text: `${total}/${limit}`,
    label: `Actions jobs ${limit}のうち 動いている${active}・寝ている${sleeping}`,
  };
}

/** Sleeping の小見出しの数：`10 · Long 8`（Long が0なら `10`） */
export function sleepingCountText(runs: readonly Pick<RunEntry, "wakeAtMs">[], now: Date): string {
  const long = runs.filter((run) => isLongSleep(run.wakeAtMs, now)).length;
  return long > 0 ? `${runs.length} · Long ${long}` : `${runs.length}`;
}
