import type { WatchedRepo } from "../config";
import { hourStarts, RATE_LIMIT, type GithubLimits } from "../dashboard/githubLimits";
import { storeUsed } from "../dashboard/rateHistoryStore";
import { getAppRateLimit, getKnownAppRateLimit, getReadsGraphql } from "./appToken";
import { syncRateHistory } from "./rateHistoryStore";

/**
 * Dashboard の GitHub limits を作る。ここで GitHub を読むのは、パイプラインの App の鍵の `GET /rate_limit` だけ
 * （5分に1回まで。回数を消費しない）。ほかはサーバーのメモリに覚えた履歴から出す。
 * `runs` は、すでに取った進捗ログの行から数えた値（呼ぶ側が渡す）。
 * `knownOnly` のときは `GET /rate_limit` を待たず、覚えている物だけで作る（全部がそろう前の段を、この読み取りで止めないため。無ければ残りは不明）
 */
export async function loadGithubLimits(input: {
  userToken: string;
  repos: WatchedRepo[];
  runs: number | null;
  now: Date;
  knownOnly?: boolean;
}): Promise<GithubLimits> {
  const nowMs = input.now.getTime();
  const app = input.knownOnly ? getKnownAppRateLimit(nowMs) : await getAppRateLimit(input.repos[0], { nowMs });
  const reads = getReadsGraphql(input.userToken);
  // 保存した履歴（入れ替わりで消えない）にメモリの点を合わせる。読めなければメモリだけ（`syncRateHistory`）
  const store = await syncRateHistory({ userToken: input.userToken, nowMs, needStore: true });
  return {
    pipeline: { remaining: app.remaining, limit: app.limit ?? RATE_LIMIT, resetAt: app.resetAt },
    reads: { remaining: reads.current.remaining, limit: RATE_LIMIT, resetAt: reads.current.resetAt },
    hourStarts: hourStarts(nowMs),
    pipelineUsed: storeUsed(store, "rest", nowMs),
    readsUsed: storeUsed(store, "graphql", nowMs),
    runs: input.runs,
  };
}
