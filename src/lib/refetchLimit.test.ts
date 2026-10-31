import { describe, expect, it } from "vitest";
import { decideRefetch, REFETCH_MIN_INTERVAL_MS } from "./refetchLimit";

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
});
