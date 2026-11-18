// GitHub limits（Issue #465）：残りの履歴から、1時間ごとに使った量を出す純粋関数。
// 入力は「残りを覚えたときの点」だけで、GitHub は読まない。

/** 残りを覚えたときの点（`at` は ms、`resetAt` は回復する時刻のUNIX秒） */
export type RateSample = { at: number; remaining: number; resetAt: number | null };

/** 1時間ごとの枠の数（直近24時間） */
export const HOUR_SLOTS = 24;
/** 上限の回数（REST・GraphQL とも、ふつうの鍵は5,000） */
export const RATE_LIMIT = 5000;

const HOUR_MS = 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * HOUR_MS;

/** 1時間ごとの枠の始まり（ms、古い順。いちばん新しい枠は「今」を含む時間） */
export function hourStarts(nowMs: number, slots: number = HOUR_SLOTS): number[] {
  const current = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return Array.from({ length: slots }, (_, i) => current - (slots - 1 - i) * HOUR_MS);
}

/**
 * 1時間ごとに使った量（古い順）。足りない時間帯は null（線を切る）。
 * 隣り合う2点の間で、同じ回復の周期の中で残りが減った分を、あとの点の時間帯に足す。
 * 回復をまたぐ所（回復の時刻が違う）・1時間より離れた点・残りが増えた所は、作り物の数字を出さず数えない。
 * 数えられた組が1つも無い時間帯は null
 */
export function hourlyUsed(samples: RateSample[], nowMs: number, slots: number = HOUR_SLOTS): (number | null)[] {
  const starts = hourStarts(nowMs, slots);
  const used: (number | null)[] = starts.map(() => null);
  for (const { slotStart, amount } of usedIncrements(samples)) {
    const slot = starts.indexOf(slotStart);
    if (slot < 0) continue;
    used[slot] = (used[slot] ?? 0) + amount;
  }
  return used;
}

/**
 * 点の列から、数えられる組ごとの「使った量」を出す（あとの点の1時間の枠の始まり ms と、減った分）。
 * 数える決まりは `hourlyUsed` と同じ（同じ回復の周期の中で減った分だけ）。保存した枠との合わせ方（`rateHistoryStore.ts`）も使う
 */
export function usedIncrements(samples: RateSample[]): { slotStart: number; amount: number }[] {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const out: { slotStart: number; amount: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (next.at - prev.at > HOUR_MS) continue;
    if (prev.resetAt === null || prev.resetAt !== next.resetAt) continue;
    if (next.remaining > prev.remaining) continue;
    out.push({ slotStart: Math.floor(next.at / HOUR_MS) * HOUR_MS, amount: prev.remaining - next.remaining });
  }
  return out;
}

/** 複数の鍵の1時間ごとの使った量を足す。全部 null の時間帯だけ null */
export function sumSeries(list: (number | null)[][], slots: number = HOUR_SLOTS): (number | null)[] {
  return Array.from({ length: slots }, (_, i) => {
    let total: number | null = null;
    for (const series of list) {
      const value = series[i];
      if (value !== null && value !== undefined) total = (total ?? 0) + value;
    }
    return total;
  });
}

/** 上限を超えた時間帯の番号（0 始まり、古い順） */
export function exceededSlots(series: (number | null)[], limit: number = RATE_LIMIT): number[] {
  return series.flatMap((value, i) => (value !== null && value > limit ? [i] : []));
}

function jst(ms: number): Date {
  return new Date(ms + JST_OFFSET_MS);
}

/** 日本時間の `11:52`（UNIX秒）。不明なら null */
export function formatResetAt(resetAt: number | null): string | null {
  if (resetAt === null) return null;
  const d = jst(resetAt * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 日本時間の時（`11`）。グラフの下の時刻に使う */
export function hourLabel(startMs: number): string {
  return String(jst(startMs).getUTCHours()).padStart(2, "0");
}

/** グラフの1行のまとめ。上限を超えた時間帯があれば書く。履歴がまだ無ければその旨 */
export function limitsSummary(
  starts: number[],
  pipeline: (number | null)[],
  reads: (number | null)[],
): string {
  const hours = observedHours(pipeline, reads);
  if (hours === 0) {
    return "使った量の履歴がまだありません。サーバーが GitHub を読むたびにたまります。";
  }
  // 記録が24時間に満たないときは、何時間分を見たかを言う（記録の無い時間を「超えていない」と言い切らない）
  const seen = hours < starts.length ? `記録があるのは直近 ${hours} 時間分だけです。` : "";
  const parts: string[] = [];
  const over = (name: string, series: (number | null)[]) => {
    const slots = exceededSlots(series);
    if (slots.length > 0) parts.push(`${name} ${slots.map((i) => `${hourLabel(starts[i])}時台`).join("・")}`);
  };
  over("Pipeline", pipeline);
  over("agent-desk reads", reads);
  const limit = RATE_LIMIT.toLocaleString("en-US");
  if (parts.length === 0) return `${seen ? `${seen}その間、` : "この24時間、"}上限 ${limit} を超えた時間帯はありません。`;
  return `${seen}上限 ${limit} を超えた時間帯があります：${parts.join("、")}。`;
}

/** 記録のある最初の枠から「今」の枠までの枠の数。記録が全く無ければ 0 */
export function observedHours(...seriesList: (number | null)[][]): number {
  let hours = 0;
  for (const series of seriesList) {
    const first = series.findIndex((value) => value !== null);
    if (first >= 0) hours = Math.max(hours, series.length - first);
  }
  return hours;
}

/** 残りの横棒の長さ（0〜1）。残りが不明なら null */
export function remainingRatio(remaining: number | null, limit: number = RATE_LIMIT): number | null {
  if (remaining === null || limit <= 0) return null;
  return Math.min(Math.max(remaining / limit, 0), 1);
}

/** 画面に渡す、小さな値だけの形（トークンは入れない） */
export type LimitGauge = { remaining: number | null; limit: number; resetAt: number | null };

export type GithubLimits = {
  pipeline: LimitGauge;
  reads: LimitGauge;
  /** 1時間ごとの枠の始まり（ms、古い順） */
  hourStarts: number[];
  pipelineUsed: (number | null)[];
  readsUsed: (number | null)[];
  /** Actions の実行の数（この24時間）。取れなければ null */
  runs: number | null;
};
