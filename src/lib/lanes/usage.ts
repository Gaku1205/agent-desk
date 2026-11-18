import { parseRunRows } from "../dashboard/summary";
import type { RepoResult } from "../github/types";
import { hourInZone, isNightHour, type ParallelSettings } from "../parallel";
import { buildPipelineRows } from "../pipeline";
import { isStepLogComment } from "../stepLog";

/**
 * Slots & Queue の Last 24h（枠の使われ方のグラフ。docs/spec.md の「Slots & Queue」）。
 * 取得済みの結果（`loadTurns` の `results`）だけから作る。GitHub は読まない。
 * 記録から取れない物は出さない（作り物の数字を出さない）
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** グラフの期間（24時間固定） */
export const USAGE_SPAN_MS = 24 * HOUR;
/** 1つの段の長さ（15分） */
export const USAGE_BUCKET_MS = 15 * MINUTE;
/** 縦の目盛りの最小の上端（0〜5） */
export const USAGE_Y_MIN = 5;

/** 枠を使う工程の、進捗ログの `step`（`mocks`・`plan`・`deploy` は枠を使わない） */
const SLOT_STEPS = new Set(["implement", "ci", "review", "fix"]);
const QUEUE_LABELS = new Set(["ai:queue", "ai:blocked"]);

/** サーバーで作る材料：15分ごとの、使っていた枠の数と順番待ちの数（その15分のうち最も多かった数） */
export type UsageSource = {
  /** 最初の段の始まり（ミリ秒） */
  startMs: number;
  /** 使っていた枠の数。進捗ログが1つも無ければ null（出さない） */
  used: number[] | null;
  queued: number[];
};

type Interval = { from: number; to: number };

/** 重なる区間をまとめる（同じ Issue が2つ数えられないように） */
function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && item.from <= last.to) last.to = Math.max(last.to, item.to);
    else merged.push({ ...item });
  }
  return merged;
}

/** 区間の重なりから、各段の「その間でいちばん多かった同時の数」 */
function peakLevels(intervals: readonly Interval[], startMs: number, count: number): number[] {
  const levels: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = startMs + i * USAGE_BUCKET_MS;
    const to = from + USAGE_BUCKET_MS;
    const points: { at: number; delta: number }[] = [];
    let active = 0;
    for (const item of intervals) {
      if (item.to <= from || item.from >= to) continue;
      if (item.from <= from) active += 1;
      else points.push({ at: item.from, delta: 1 });
      if (item.to < to) points.push({ at: item.to, delta: -1 });
    }
    points.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let peak = active;
    for (const point of points) {
      active += point.delta;
      peak = Math.max(peak, active);
    }
    levels.push(peak);
  }
  return levels;
}

/**
 * 結果から材料を作る。入力は進捗ログ（工程の開始と所要時間）とラベルの付け外しの出来事だけ。
 * 読めたリポジトリが無ければ null
 */
export function buildUsageSource(results: readonly RepoResult[], now: Date): UsageSource | null {
  const loaded = results.flatMap((result) => (result.ok ? [result] : []));
  if (loaded.length === 0) return null;
  const count = USAGE_SPAN_MS / USAGE_BUCKET_MS;
  const endMs = Math.ceil(now.getTime() / USAGE_BUCKET_MS) * USAGE_BUCKET_MS;
  const startMs = endMs - USAGE_SPAN_MS;

  const used: Interval[] = [];
  const queued: Interval[] = [];
  let hasLog = false;

  for (const { owner, repo, data } of loaded) {
    // 枠を使った時間：進捗ログの、枠を使う工程の行。1つの Issue で重なる分は1つにまとめる
    const perIssue = new Map<number, Interval[]>();
    for (const comment of data.comments) {
      if (!isStepLogComment(comment.body)) continue;
      for (const row of parseRunRows(comment.body, now)) {
        hasLog = true;
        if (!SLOT_STEPS.has(row.step)) continue;
        const list = perIssue.get(comment.issueNumber) ?? [];
        list.push({ from: row.started, to: row.started + row.durationMs });
        perIssue.set(comment.issueNumber, list);
      }
    }
    for (const list of perIssue.values()) used.push(...mergeIntervals(list));

    // 順番待ちだった時間：`ai:queue`・`ai:blocked` が付いてから外れるまで。
    // 外れた記録が無いのは、いま順番待ちの Issue だけ「今まで」とし、それ以外は終わりが分からないので数えない
    const waitingNow = new Set(
      buildPipelineRows(data, now, `${owner}/${repo}`)
        .filter((row) => row.status.stage === "queued")
        .map((row) => row.issue.number),
    );
    const events = data.events
      .flatMap((event) => {
        const at = Date.parse(event.createdAt);
        const label = event.labelName;
        if (event.issueNumber === null || Number.isNaN(at) || label === null || !QUEUE_LABELS.has(label)) return [];
        if (event.event !== "labeled" && event.event !== "unlabeled") return [];
        return [{ issue: event.issueNumber, label, on: event.event === "labeled", at }];
      })
      .sort((a, b) => a.at - b.at);
    const state = new Map<number, { on: Set<string>; since: number | null }>();
    for (const event of events) {
      const item = state.get(event.issue) ?? { on: new Set<string>(), since: null };
      state.set(event.issue, item);
      if (event.on) {
        if (item.on.size === 0) item.since = event.at;
        item.on.add(event.label);
      } else if (item.on.delete(event.label) && item.on.size === 0 && item.since !== null) {
        queued.push({ from: item.since, to: event.at });
        item.since = null;
      }
    }
    for (const [issue, item] of state) {
      if (item.on.size > 0 && item.since !== null && waitingNow.has(issue)) {
        queued.push({ from: item.since, to: now.getTime() });
      }
    }
  }

  const queuedLevels = peakLevels(queued, startMs, count);
  if (!hasLog && queuedLevels.every((level) => level === 0)) return null;
  return { startMs, used: hasLog ? peakLevels(used, startMs, count) : null, queued: queuedLevels };
}

export type UsageBucket = {
  startMs: number;
  used: number | null;
  queued: number;
  /** その時間帯の枠の上限（並列の設定が読めなければ null） */
  limit: number | null;
  night: boolean;
};

export type UsageChart = {
  buckets: UsageBucket[];
  /** 縦の上端（5以上。5を超えるときは目盛りの間隔の倍数） */
  yMax: number;
  /** 縦の目盛り（0から上端まで。5以下なら1ずつ） */
  yTicks: number[];
  /** 夜の時間帯（段の番号。`to` は含まない） */
  nightSpans: { from: number; to: number }[];
  /** 順番待ちがいちばん多かった所（無ければ null） */
  peak: { index: number; value: number } | null;
  /** 横の目盛り（6時間ごと）。`index` は段の番号 */
  ticks: { index: number; label: string }[];
  /** 空きの枠があるのに順番待ちだった時間（ミリ秒）。上限か使った数が分からなければ null */
  blockedMs: number | null;
  /** 使っていた枠のいちばん多かった数。分からなければ null */
  maxUsed: number | null;
  /** 昼・夜の上限（設定が読めなければ null） */
  limits: { day: number; night: number | null } | null;
};

/** 縦の目盛りの間隔：目盛りが6本ほどに収まる 1・2・5・10… */
function niceStep(top: number): number {
  const raw = top / 5;
  let step = 1;
  for (let scale = 1; step < raw; scale *= 10) {
    step = [1, 2, 5, 10].map((base) => base * scale).find((candidate) => candidate >= raw) ?? step;
  }
  return step;
}

/** 材料と並列の設定から、グラフに描く物を決める */
export function buildUsageChart(source: UsageSource, settings: ParallelSettings | null): UsageChart {
  const hours = settings?.nightHours ?? null;
  const buckets: UsageBucket[] = source.queued.map((queued, index) => {
    const startMs = source.startMs + index * USAGE_BUCKET_MS;
    const middle = new Date(startMs + USAGE_BUCKET_MS / 2);
    const night = isNightHour(hourInZone(middle), hours);
    return {
      startMs,
      used: source.used ? source.used[index] : null,
      queued,
      limit: settings ? (night ? settings.night : settings.day) : null,
      night,
    };
  });

  const nightSpans: { from: number; to: number }[] = [];
  buckets.forEach((bucket, index) => {
    if (!bucket.night) return;
    const last = nightSpans.at(-1);
    if (last && last.to === index) last.to = index + 1;
    else nightSpans.push({ from: index, to: index + 1 });
  });

  let peak: UsageChart["peak"] = null;
  for (let index = 0; index < buckets.length; index += 1) {
    const queued = buckets[index].queued;
    if (queued > 0 && (peak === null || queued > peak.value)) peak = { index, value: queued };
  }

  const ticks: UsageChart["ticks"] = [];
  buckets.forEach((bucket, index) => {
    if (bucket.startMs % HOUR !== 0) return;
    const hour = hourInZone(new Date(bucket.startMs));
    if (hour % 6 === 0) ticks.push({ index, label: `${hour}:00` });
  });

  const canJudge = settings !== null && source.used !== null;
  const blockedMs = canJudge
    ? buckets.filter((bucket) => bucket.queued > 0 && (bucket.used ?? 0) < (bucket.limit ?? 0)).length * USAGE_BUCKET_MS
    : null;
  const maxUsed = source.used ? Math.max(0, ...source.used) : null;
  const top = Math.max(
    USAGE_Y_MIN,
    ...buckets.map((bucket) => Math.max(bucket.used ?? 0, bucket.queued, bucket.limit ?? 0)),
  );
  const yStep = niceStep(top);
  const yMax = Math.ceil(top / yStep) * yStep;
  const yTicks = Array.from({ length: yMax / yStep + 1 }, (_, i) => i * yStep);

  return {
    buckets,
    yMax,
    yTicks,
    nightSpans,
    peak,
    ticks,
    blockedMs,
    maxUsed,
    limits: settings ? { day: settings.day, night: hours ? settings.night : null } : null,
  };
}

/** グラフの下の1行 */
export function usageSummary(chart: UsageChart, formatSpan: (ms: number) => string): string {
  if (chart.blockedMs !== null) {
    return chart.blockedMs > 0
      ? `空きの枠があるのに入れなかった時間は、合計 ${formatSpan(chart.blockedMs)}`
      : "空きの枠があるのに入れなかった時間は、ありませんでした";
  }
  const parts: string[] = [];
  if (chart.maxUsed !== null) parts.push(`使っていた枠は最大 ${chart.maxUsed}件`);
  parts.push(chart.peak ? `順番待ちは最大 ${chart.peak.value}件` : "順番待ちはありませんでした");
  return parts.join("、");
}
