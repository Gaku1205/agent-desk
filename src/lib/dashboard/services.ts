// Dashboard の Services（docs/spec.md の「Dashboard」の「Services」。Issue #719）。
// 入力から出力が決まる純粋関数だけを置く。GitHub を読む所は `src/lib/github/supabaseKeepalive.ts` と `cpuUsage.ts`。

import { jstDateKey, recentDateKeys } from "../usage/cpuBudget";
import { formatResetAt, type GithubLimits, type LimitGauge } from "./githubLimits";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;

/** Vercel の Hobby の CPU の上限：30日で4時間（docs/spec.md の「サーバーの CPU の予算」） */
export const CPU_LIMIT_MS = 4 * HOUR_MS;
/** 上限に対する「悪い」の境目（これを超えたら悪い） */
export const BAD_RATIO = 0.9;
/** CPU の窓の日数 */
export const CPU_WINDOW_DAYS = 30;

export type ServiceKind = "supabase" | "vercel" | "github";
/** よい・悪い・分からない */
export type ServiceState = "ok" | "bad" | "unknown";

/** 画面に渡す1行（小さな値だけ。トークンは入れない） */
export type ServiceRow = {
  key: string;
  kind: ServiceKind;
  state: ServiceState;
  name: string;
  /** 中の1行目 */
  main: string;
  /** 中の2行目 */
  sub: string | null;
  /** 使った割合の棒（0〜1）。無ければ null */
  bar: number | null;
  /** 右の補足。href があればリンク */
  right: { text: string; href: string | null } | null;
};

export type ServicesView = {
  /** 確かめた時刻（ISO） */
  checkedAt: string;
  rows: ServiceRow[];
};

/** Supabase の見張り（`supabase-keepalive.yml`）の、いちばん新しい成否 */
export type SupabaseKeepalive = {
  owner: string;
  repo: string;
  ok: boolean;
  /** その実行の時刻（ms） */
  at: number;
  /** 続けて失敗している実行の、いちばん古い時刻（ms）。よいときは null */
  failingSince: number | null;
  /** 失敗の文（注釈）。無ければ null */
  message: string | null;
  /** 実行のログ（html_url） */
  logUrl: string | null;
};

/** Actions の実行の一覧の1つ（読むのに要る分だけ） */
export type KeepaliveRun = { conclusion: string | null; createdAt: number; htmlUrl: string | null; id: number };

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/**
 * 新しい順の実行の一覧から、いちばん新しい成否と、続けて失敗している最初の時刻を決める。
 * 成功・失敗以外（cancelled・skipped など）は飛ばす。決められなければ null
 */
export function supabaseVerdict(
  runs: KeepaliveRun[],
): { ok: boolean; latest: KeepaliveRun; failingSince: number | null } | null {
  const judged = runs.filter((run) => run.conclusion === "success" || FAILED.has(run.conclusion ?? ""));
  const latest = judged[0];
  if (!latest) return null;
  if (latest.conclusion === "success") return { ok: true, latest, failingSince: null };
  let since = latest.createdAt;
  for (const run of judged) {
    if (run.conclusion === "success") break;
    since = Math.min(since, run.createdAt);
  }
  return { ok: false, latest, failingSince: since };
}

/** 失敗の文が一時停止を言っているか（「paused」［大文字小文字を問わない］か「一時停止」） */
export function isPausedMessage(message: string | null): boolean {
  if (!message) return false;
  return /paused/i.test(message) || message.includes("一時停止");
}

/** 失敗の文から、Supabase のダッシュボードのリンクを取る。無ければ null */
export function supabaseDashboardUrl(message: string | null): string | null {
  const match = message?.match(/https:\/\/supabase\.com\/dashboard\/project\/[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

/** `2日前から`・`3時間前から`・`12分前から`（切り捨て。最小1分） */
export function sinceWords(sinceMs: number, nowMs: number): string {
  const diff = Math.max(nowMs - sinceMs, 0);
  if (diff >= DAY_MS) return `${Math.floor(diff / DAY_MS)}日前から`;
  if (diff >= HOUR_MS) return `${Math.floor(diff / HOUR_MS)}時間前から`;
  return `${Math.max(Math.floor(diff / MINUTE_MS), 1)}分前から`;
}

function jst(ms: number): Date {
  return new Date(ms + JST_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 日本時間の `05:43` */
export function clockLabel(ms: number): string {
  const d = jst(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 同じ日（日本時間）なら `05:43`、違えば `11/18 05:43` */
function whenLabel(ms: number, nowMs: number): string {
  if (jstDateKey(new Date(ms)) === jstDateKey(new Date(nowMs))) return clockLabel(ms);
  const d = jst(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${clockLabel(ms)}`;
}

/** CPU の時間：`2h 50m`・`4h`・`3m42s`・`3m`・`20s` */
export function formatCpu(ms: number): string {
  const seconds = Math.max(Math.round(ms / 1000), 0);
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s === 0 ? `${m}m` : `${m}m${s}s`;
  }
  return `${seconds}s`;
}

export type CpuForecast = {
  /** 直近30日（今日を含む）の合計 ms */
  totalMs: number;
  todayMs: number;
  /** このままなら30日で（今日の分 × 30） */
  projectedMs: number;
  /** 合計 ÷ 上限 */
  ratio: number;
  bad: boolean;
};

/** 日ごとの合計から、30日の合計・今日の分・このままなら30日で、を出す */
export function cpuForecast(totalsByDate: ReadonlyMap<string, number>, now: Date): CpuForecast {
  const keys = recentDateKeys(now, CPU_WINDOW_DAYS);
  const totalMs = keys.reduce((sum, key) => sum + (totalsByDate.get(key) ?? 0), 0);
  const todayMs = totalsByDate.get(keys[0]) ?? 0;
  const ratio = totalMs / CPU_LIMIT_MS;
  return { totalMs, todayMs, projectedMs: todayMs * CPU_WINDOW_DAYS, ratio, bad: ratio > BAD_RATIO };
}

/**
 * 上限の90%を超えているとき、この先の使用量を0として、30日の窓から古い日が出ていき、
 * 合計が上限の90%以下になる最初の日（日本時間の `11/24`）。超えていなければ null
 */
export function cpuRecoveryDate(totalsByDate: ReadonlyMap<string, number>, now: Date): string | null {
  const keys = recentDateKeys(now, CPU_WINDOW_DAYS); // 今日が先頭、いちばん古い日が最後
  const values = keys.map((key) => totalsByDate.get(key) ?? 0);
  let sum = values.reduce((a, b) => a + b, 0);
  if (sum <= CPU_LIMIT_MS * BAD_RATIO) return null;
  for (let k = 1; k <= CPU_WINDOW_DAYS; k++) {
    sum -= values[CPU_WINDOW_DAYS - k];
    if (sum <= CPU_LIMIT_MS * BAD_RATIO) {
      const d = jst(now.getTime() + k * DAY_MS);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    }
  }
  return null;
}

function usedRatio(gauge: LimitGauge): number | null {
  if (gauge.remaining === null || gauge.limit <= 0) return null;
  return Math.min(Math.max(1 - gauge.remaining / gauge.limit, 0), 1);
}

function count(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function supabaseRow(item: SupabaseKeepalive, nowMs: number): ServiceRow {
  const key = `supabase:${item.owner}/${item.repo}`;
  if (item.ok) {
    return {
      key,
      kind: "supabase",
      state: "ok",
      name: "Supabase",
      main: `${item.repo} · 最後に起こした ${whenLabel(item.at, nowMs)}`,
      sub: null,
      bar: null,
      right: null,
    };
  }
  const dashboard = supabaseDashboardUrl(item.message);
  return {
    key,
    kind: "supabase",
    state: "bad",
    name: "Supabase",
    main: isPausedMessage(item.message) ? `${item.repo} が一時停止しています` : "Supabase に書き込めませんでした",
    sub: sinceWords(item.failingSince ?? item.at, nowMs),
    bar: null,
    right: dashboard
      ? { text: "Resume を開く →", href: dashboard }
      : item.logUrl
        ? { text: "実行のログを開く →", href: item.logUrl }
        : null,
  };
}

function vercelRow(totals: ReadonlyMap<string, number> | null, now: Date): ServiceRow {
  if (totals === null) {
    return {
      key: "vercel",
      kind: "vercel",
      state: "unknown",
      name: "Vercel の CPU",
      main: "使用量を読めませんでした",
      sub: null,
      bar: null,
      right: null,
    };
  }
  const forecast = cpuForecast(totals, now);
  const recovery = forecast.bad ? cpuRecoveryDate(totals, now) : null;
  return {
    key: "vercel",
    kind: "vercel",
    state: forecast.bad ? "bad" : "ok",
    name: "Vercel の CPU",
    main: `30日で ${formatCpu(forecast.totalMs)} / ${formatCpu(CPU_LIMIT_MS)}`,
    sub: `今日 ${formatCpu(forecast.todayMs)} · このままなら 30日で ${formatCpu(forecast.projectedMs)}`,
    bar: Math.min(forecast.ratio, 1),
    right: recovery ? { text: `${recovery} に戻る見込み`, href: null } : null,
  };
}

function githubRow(limits: GithubLimits): ServiceRow {
  const pipeline = usedRatio(limits.pipeline);
  const reads = usedRatio(limits.reads);
  const worse = (reads ?? -1) > (pipeline ?? -1) ? limits.reads : limits.pipeline;
  const bar = pipeline === null && reads === null ? null : Math.max(pipeline ?? 0, reads ?? 0);
  const reset = formatResetAt(worse.resetAt);
  return {
    key: "github",
    kind: "github",
    state: bar === null ? "unknown" : bar > BAD_RATIO ? "bad" : "ok",
    name: "GitHub の回数",
    main: `Pipeline 残り ${count(limits.pipeline.remaining)} / ${count(limits.pipeline.limit)} · reads 残り ${count(limits.reads.remaining)} / ${count(limits.reads.limit)}`,
    sub: null,
    bar,
    right: reset ? { text: `resets at ${reset}`, href: null } : null,
  };
}

const KIND_ORDER: Record<ServiceKind, number> = { supabase: 0, vercel: 1, github: 2 };

/** 悪い物を上に。同じ中では Supabase → Vercel → GitHub（同じ種類は元の並び） */
export function orderServiceRows(rows: ServiceRow[]): ServiceRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const bad = Number(b.row.state === "bad") - Number(a.row.state === "bad");
      if (bad !== 0) return bad;
      const kind = KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind];
      return kind !== 0 ? kind : a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Services の行を作る（並べ替えたあと） */
export function buildServiceRows(input: {
  supabase: SupabaseKeepalive[];
  cpuTotals: ReadonlyMap<string, number> | null;
  limits: GithubLimits;
  now: Date;
}): ServiceRow[] {
  const nowMs = input.now.getTime();
  return orderServiceRows([
    ...input.supabase.map((item) => supabaseRow(item, nowMs)),
    vercelRow(input.cpuTotals, input.now),
    githubRow(input.limits),
  ]);
}
