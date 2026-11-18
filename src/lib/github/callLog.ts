import { AsyncLocalStorage } from "node:async_hooks";

// GitHub を呼んだ回数と時間を、種類ごとに数える（docs/spec.md の「サーバーの各段の時間」）。サーバーだけで使う。
// 数えるのは `withCallLog` の中で動いた呼び出しだけ（ふだんのページの表示では数えない＝何もしない）。
// 残すのは種類・回数・ms だけで、URL・リポジトリの名前・トークン・返事の中身は残さない。

/** 呼び出しの種類：graphql＝同期の問い合わせ、rest＝REST の読み取り、write＝書き込み、key＝App の鍵の確認と取得 */
export type CallKind = "graphql" | "rest" | "write" | "key";

/** 種類ごとの回数と、かかった時間の合計・いちばん長い1回（ms） */
export type CallTotals = Record<CallKind, { count: number; ms: number; maxMs: number }>;

export function emptyCallTotals(): CallTotals {
  return {
    graphql: { count: 0, ms: 0, maxMs: 0 },
    rest: { count: 0, ms: 0, maxMs: 0 },
    write: { count: 0, ms: 0, maxMs: 0 },
    key: { count: 0, ms: 0, maxMs: 0 },
  };
}

/** 1回の呼び出しを足す（純粋関数ではなく、渡した入れ物を書き換える） */
export function addCall(totals: CallTotals, kind: CallKind, ms: number): void {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const entry = totals[kind];
  entry.count += 1;
  entry.ms += safe;
  entry.maxMs = Math.max(entry.maxMs, safe);
}

const storage = new AsyncLocalStorage<CallTotals>();

/** `run` の中で動いた GitHub の呼び出しを数えて、結果と一緒に返す */
export async function withCallLog<T>(run: () => Promise<T>): Promise<{ value: T; calls: CallTotals }> {
  const calls = emptyCallTotals();
  const value = await storage.run(calls, run);
  return { value, calls };
}

/**
 * GitHub への1回の呼び出しを測る。数えている最中（`withCallLog` の中）でなければ、そのまま呼ぶだけ。
 * 失敗した呼び出しも数える
 */
export async function timedCall<T>(kind: CallKind, call: () => Promise<T>): Promise<T> {
  const totals = storage.getStore();
  if (!totals) return call();
  const from = performance.now();
  try {
    return await call();
  } finally {
    addCall(totals, kind, performance.now() - from);
  }
}
