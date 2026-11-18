import { describe, expect, it } from "vitest";
import {
  decideRefetch,
  nextRefetchIntervalMs,
  REFETCH_MAX_INTERVAL_MS,
  REFETCH_MIN_INTERVAL_MS,
  REFETCH_QUIET_RESET_MS,
} from "./refetchLimit";

describe("decideRefetch", () => {
  it("まだ取っていなければ今取る", () => {
    expect(decideRefetch({ lastFetchedAt: null, lastChangedAt: null, now: 1000 })).toEqual({
      refetch: true,
      waitSeconds: 0,
    });
  });

  it("取った後に変わっていなければ取り直さない", () => {
    expect(decideRefetch({ lastFetchedAt: 1000, lastChangedAt: null, now: 99_000 })).toEqual({
      refetch: false,
      waitSeconds: 0,
    });
    expect(decideRefetch({ lastFetchedAt: 1000, lastChangedAt: 1000, now: 99_000 }).refetch).toBe(false);
  });

  it("反映済みの変化の時刻を渡したときは、それと比べる（前に取った時刻より前の変化でも取りこぼさない）", () => {
    const input = { lastFetchedAt: 1000, lastChangedAt: 900, now: 99_000 };
    expect(decideRefetch(input).refetch).toBe(false);
    expect(decideRefetch({ ...input, reflectedChangedAt: 800 }).refetch).toBe(true);
    expect(decideRefetch({ ...input, reflectedChangedAt: 900 }).refetch).toBe(false);
  });

  it("静かなあとの最初の変化は、すぐ取り直す", () => {
    const fetched = 0;
    const now = 10 * 60_000;
    expect(decideRefetch({ lastFetchedAt: fetched, lastChangedAt: now - 1, now })).toEqual({
      refetch: true,
      waitSeconds: 0,
    });
  });

  it("ちょうど15秒なら取り直す。1ミリ秒足りなければ1秒待つ", () => {
    expect(decideRefetch({ lastFetchedAt: 0, lastChangedAt: 100, now: REFETCH_MIN_INTERVAL_MS }).refetch).toBe(true);
    expect(decideRefetch({ lastFetchedAt: 0, lastChangedAt: 100, now: REFETCH_MIN_INTERVAL_MS - 1 })).toEqual({
      refetch: false,
      waitSeconds: 1,
    });
  });

  it("15秒の間に変わったら、残りの秒数を切り上げて返す", () => {
    expect(decideRefetch({ lastFetchedAt: 0, lastChangedAt: 1000, now: 5000 })).toEqual({
      refetch: false,
      waitSeconds: 10,
    });
    expect(decideRefetch({ lastFetchedAt: 0, lastChangedAt: 1000, now: 5500 }).waitSeconds).toBe(10);
  });

  it("15秒の間に何回変わっても、15秒たったら1回だけ取り直す", () => {
    let fetches = 0;
    let lastFetchedAt: number | null = 0;
    let changedAt = 0;
    for (let now = 5000; now <= 60_000; now += 5000) {
      changedAt = now - 1; // 5秒おきに変わり続ける
      if (decideRefetch({ lastFetchedAt, lastChangedAt: changedAt, now }).refetch) {
        fetches += 1;
        lastFetchedAt = now;
      }
    }
    // 15秒、30秒、45秒、60秒の4回だけ
    expect(fetches).toBe(4);
  });

  it("あける時間を渡したら、その時間がたつまで待つ", () => {
    const input = { lastFetchedAt: 0, lastChangedAt: 1000, minIntervalMs: 60_000 };
    expect(decideRefetch({ ...input, now: 15_000 })).toEqual({ refetch: false, waitSeconds: 45 });
    expect(decideRefetch({ ...input, now: 59_999 })).toEqual({ refetch: false, waitSeconds: 1 });
    expect(decideRefetch({ ...input, now: 60_000 })).toEqual({ refetch: true, waitSeconds: 0 });
  });
});

describe("nextRefetchIntervalMs", () => {
  it("2分以上静かだったあとは、最短の15秒", () => {
    expect(nextRefetchIntervalMs({ previousIntervalMs: 60_000, sinceLastFetchMs: REFETCH_QUIET_RESET_MS })).toBe(
      REFETCH_MIN_INTERVAL_MS,
    );
    expect(nextRefetchIntervalMs({ previousIntervalMs: null, sinceLastFetchMs: 10 * 60_000 })).toBe(15_000);
  });

  it("2分たたないうちにまた取り直すときは2倍にする（15秒 → 30秒 → 60秒。上限は60秒）", () => {
    expect(nextRefetchIntervalMs({ previousIntervalMs: 15_000, sinceLastFetchMs: 15_000 })).toBe(30_000);
    expect(nextRefetchIntervalMs({ previousIntervalMs: 30_000, sinceLastFetchMs: 30_000 })).toBe(60_000);
    expect(nextRefetchIntervalMs({ previousIntervalMs: 60_000, sinceLastFetchMs: 60_000 })).toBe(REFETCH_MAX_INTERVAL_MS);
    expect(nextRefetchIntervalMs({ previousIntervalMs: 60_000, sinceLastFetchMs: REFETCH_QUIET_RESET_MS - 1 })).toBe(
      60_000,
    );
  });

  it("前の間隔が分からない・おかしいときは、15秒として数える", () => {
    expect(nextRefetchIntervalMs({ previousIntervalMs: null, sinceLastFetchMs: 20_000 })).toBe(30_000);
    expect(nextRefetchIntervalMs({ previousIntervalMs: 0, sinceLastFetchMs: 20_000 })).toBe(30_000);
    expect(nextRefetchIntervalMs({ previousIntervalMs: Number.NaN, sinceLastFetchMs: 20_000 })).toBe(30_000);
    expect(nextRefetchIntervalMs({ previousIntervalMs: 15_000, sinceLastFetchMs: Number.NaN })).toBe(15_000);
  });

  it("変わり続けるリポジトリの取り直しは、1時間に60回ほど（15秒ごとの240回から減る）", () => {
    let fetches = 0;
    let lastFetchedAt = 0;
    let intervalMs = REFETCH_MIN_INTERVAL_MS;
    for (let now = 5000; now <= 60 * 60_000; now += 5000) {
      const decision = decideRefetch({ lastFetchedAt, lastChangedAt: now - 1, now, minIntervalMs: intervalMs });
      if (!decision.refetch) continue;
      intervalMs = nextRefetchIntervalMs({ previousIntervalMs: intervalMs, sinceLastFetchMs: now - lastFetchedAt });
      lastFetchedAt = now;
      fetches += 1;
    }
    expect(fetches).toBeLessThanOrEqual(62);
    expect(fetches).toBeGreaterThanOrEqual(58);
  });
});
