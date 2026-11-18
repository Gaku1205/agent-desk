// GitHub limits の履歴を、入れ替わりで消えない所（Variable `AGENT_DESK_RATE_HISTORY`）に残すための純粋関数（Issue #532）。
// 入力は点と保存の中身だけで、GitHub は読まない。保存する中身は1時間の枠ごとの使った量と「最後の点」だけ（秘密・トークンは入れない）。

import { hourStarts, sumSeries, usedIncrements, type RateSample } from "./githubLimits";

/** 保存先の Variable の名前（`SETTINGS_REPO` の Actions Variable） */
export const RATE_HISTORY_VARIABLE = "AGENT_DESK_RATE_HISTORY";
/** Variable の上限（48KB） */
export const RATE_HISTORY_MAX_BYTES = 48 * 1024;
/** 書くのは、前に確かめてから10分以上たったときだけ */
export const RATE_HISTORY_WRITE_INTERVAL_MS = 10 * 60 * 1000;
/** 保存する枠の数（直近24時間に、余裕の1時間） */
export const STORED_SLOTS = 25;

/** 1つの鍵の履歴。`used` は 枠の始まり（ms の文字列）→ 使った量、`last` は次の差分の計算に使う最後の点 */
export type RateChain = { used: Record<string, number>; last: RateSample | null };

/** 保存の中身。`rest`・`graphql` の下に、鍵の名前（`user`・`app-<インストールID>`）ごとの履歴 */
export type RateHistoryStore = {
  v: 1;
  rest: Record<string, RateChain>;
  graphql: Record<string, RateChain>;
};

export type RateResource = "rest" | "graphql";

/** メモリにある点（鍵の名前ごと） */
export type LiveRateHistories = Record<RateResource, Record<string, RateSample[]>>;

export function emptyStore(): RateHistoryStore {
  return { v: 1, rest: {}, graphql: {} };
}

/** いちばん古く残す枠の始まり（ms） */
function oldestKept(nowMs: number): number {
  return hourStarts(nowMs, STORED_SLOTS)[0];
}

/** 古い枠と古い最後の点を捨てる */
export function pruneChain(chain: RateChain, nowMs: number): RateChain {
  const oldest = oldestKept(nowMs);
  const used: Record<string, number> = {};
  for (const [start, amount] of Object.entries(chain.used)) {
    if (Number(start) >= oldest) used[start] = amount;
  }
  const last = chain.last && chain.last.at >= oldest ? chain.last : null;
  return { used, last };
}

/**
 * 保存した履歴にメモリの点を合わせる。保存した `last` より後の点だけを足す（それ以前の点は保存した枠に入っているので、
 * 二重に数えない）。`last` を先頭に新しい点を時刻順につなぎ、隣り合う2点を `usedIncrements` の決まりで数える
 */
export function mergeChain(stored: RateChain | undefined, points: RateSample[], nowMs: number): RateChain {
  const base = stored ?? { used: {}, last: null };
  const cutoff = base.last?.at ?? -Infinity;
  const fresh = points.filter((point) => point.at > cutoff).sort((a, b) => a.at - b.at);
  const used = { ...base.used };
  const sequence = base.last ? [base.last, ...fresh] : fresh;
  for (const { slotStart, amount } of usedIncrements(sequence)) {
    const key = String(slotStart);
    used[key] = (used[key] ?? 0) + amount;
  }
  const last = sequence.length > 0 ? sequence[sequence.length - 1] : null;
  return pruneChain({ used, last: last ? { at: last.at, remaining: last.remaining, resetAt: last.resetAt } : null }, nowMs);
}

/** 保存の中身に、メモリの点を合わせる。メモリに無い鍵（別のサーバーが書いた分）もそのまま残す */
export function mergeStore(stored: RateHistoryStore, live: LiveRateHistories, nowMs: number): RateHistoryStore {
  const out = emptyStore();
  for (const resource of ["rest", "graphql"] as const) {
    const labels = new Set([...Object.keys(stored[resource]), ...Object.keys(live[resource])]);
    for (const label of labels) {
      const chain = mergeChain(stored[resource][label], live[resource][label] ?? [], nowMs);
      if (Object.keys(chain.used).length > 0 || chain.last !== null) out[resource][label] = chain;
    }
  }
  return out;
}

/** 保存の中身から、1時間ごとに使った量（古い順・24枠）。数えた枠が無い所は null。鍵が複数あれば枠ごとに足す */
export function storeUsed(
  store: RateHistoryStore,
  resource: RateResource,
  nowMs: number,
  labels?: string[],
): (number | null)[] {
  const starts = hourStarts(nowMs);
  const chains = Object.entries(store[resource]).filter(([label]) => !labels || labels.includes(label));
  return sumSeries(chains.map(([, chain]) => starts.map((start) => chain.used[String(start)] ?? null)));
}

function isSample(value: unknown): value is RateSample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.at === "number" &&
    Number.isFinite(v.at) &&
    typeof v.remaining === "number" &&
    Number.isFinite(v.remaining) &&
    (v.resetAt === null || (typeof v.resetAt === "number" && Number.isFinite(v.resetAt)))
  );
}

function parseChains(value: unknown): Record<string, RateChain> {
  const out: Record<string, RateChain> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [label, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const chain = raw as { used?: unknown; last?: unknown };
    const used: Record<string, number> = {};
    if (typeof chain.used === "object" && chain.used !== null) {
      for (const [start, amount] of Object.entries(chain.used as Record<string, unknown>)) {
        if (Number.isFinite(Number(start)) && typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
          used[start] = amount;
        }
      }
    }
    out[label] = { used, last: isSample(chain.last) ? { at: chain.last.at, remaining: chain.last.remaining, resetAt: chain.last.resetAt } : null };
  }
  return out;
}

/** Variable の文字列を読む。無い・壊れている・形が違うときは空 */
export function parseStore(text: string | null): RateHistoryStore {
  if (!text) return emptyStore();
  try {
    const raw = JSON.parse(text) as { v?: unknown; rest?: unknown; graphql?: unknown } | null;
    if (!raw || raw.v !== 1) return emptyStore();
    return { v: 1, rest: parseChains(raw.rest), graphql: parseChains(raw.graphql) };
  } catch {
    return emptyStore();
  }
}

/** Variable に書く文字列。上限（48KB）を超えるときは null（書かない） */
export function serializeStore(store: RateHistoryStore): string | null {
  const text = JSON.stringify(store);
  return new TextEncoder().encode(text).length <= RATE_HISTORY_MAX_BYTES ? text : null;
}

/**
 * 書くかどうか：前に確かめてから10分以上たっていて（まだ確かめていなければ書ける）、中身が変わっているときだけ。
 * `previous` は読んだ（または書いた）文字列、`next` は書こうとする文字列
 */
export function shouldWriteStore(input: {
  lastCheckedAt: number | null;
  nowMs: number;
  previous: string | null;
  next: string | null;
}): boolean {
  if (input.next === null) return false;
  if (input.lastCheckedAt !== null && input.nowMs - input.lastCheckedAt < RATE_HISTORY_WRITE_INTERVAL_MS) return false;
  return input.previous !== input.next;
}

/** 前に確かめてから10分たったか（たっていなければ、Variable を読み直すこともしない） */
export function isCheckDue(lastCheckedAt: number | null, nowMs: number): boolean {
  return lastCheckedAt === null || nowMs - lastCheckedAt >= RATE_HISTORY_WRITE_INTERVAL_MS;
}
