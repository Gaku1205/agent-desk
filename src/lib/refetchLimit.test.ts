import { describe, expect, it } from "vitest";
import {
  decideRefetch,
  isSettledChange,
  REFETCH_PERIOD_MS,
  REFETCH_URGENT_MIN_INTERVAL_MS,
  refetchPeriod,
  type RefetchRecord,
} from "./refetchLimit";

const P = REFETCH_PERIOD_MS;

describe("refetchPeriod / isSettledChange", () => {
  it("区切りは60秒ごと", () => {
    expect(refetchPeriod(0)).toBe(0);
    expect(refetchPeriod(P - 1)).toBe(0);
    expect(refetchPeriod(P)).toBe(1);
    expect(refetchPeriod(10 * P + 5)).toBe(10);
  });

  it("2つ前の区切りの始まりより前の変化は、片づいている", () => {
    const now = 10 * P + 30_000; // 区切り10の途中
    expect(isSettledChange(8 * P - 1, now)).toBe(true);
    expect(isSettledChange(8 * P, now)).toBe(false);
    expect(isSettledChange(now, now)).toBe(false);
  });
});

describe("decideRefetch", () => {
  const record = (changedAt: number, at: number, urgentAt = 1): RefetchRecord => ({ changedAt, urgentAt, at });

  it("持ち分が2回分とも残っていれば（静かだった）、急ぎでなくてもすぐ取り直す。1つ前の区切りの分から使う", () => {
    expect(decideRefetch({ now: 5000, changedAt: 4000, urgentAt: 1, current: null, previous: null })).toEqual({
      spend: "previous",
      released: null,
    });
  });

  it("記録にある物より後に変わっていなければ、取り直さない", () => {
    const previous = record(4000, 5000);
    expect(decideRefetch({ now: 9000, changedAt: 4000, urgentAt: 1, current: null, previous })).toEqual({
      spend: null,
      released: 4000,
    });
  });

  it("急ぎでない知らせだけなら、1回分残っていても待つ（急ぎの分を残す）", () => {
    const previous = record(4000, 5000);
    expect(decideRefetch({ now: 30_000, changedAt: 20_000, urgentAt: 1, current: null, previous })).toEqual({
      spend: null,
      released: 4000,
    });
  });

  it("急ぎの知らせが来ていれば、前に取ってから5秒以上で、残っている1回分を使う", () => {
    const previous = record(4000, 5000);
    const input = { changedAt: 6000, urgentAt: 2, current: null, previous };
    expect(decideRefetch({ ...input, now: 5000 + REFETCH_URGENT_MIN_INTERVAL_MS - 1 }).spend).toBeNull();
    expect(decideRefetch({ ...input, now: 5000 + REFETCH_URGENT_MIN_INTERVAL_MS })).toEqual({
      spend: "current",
      released: 4000,
    });
  });

  it("急ぎの知らせでも、2回分とも使っていれば待つ", () => {
    const previous = record(4000, 5000);
    const current = record(6000, 10_000, 2);
    expect(decideRefetch({ now: 40_000, changedAt: 30_000, urgentAt: 3, current, previous })).toEqual({
      spend: null,
      released: 6000,
    });
  });

  it("急ぎかどうかは、後に使った記録が見た「急ぎの知らせの時刻」と比べる", () => {
    const previous = record(4000, 5000, 1);
    const current = record(6000, 10_000, 2);
    // 今の区切りの分だけ残っている形（1つ前の分は使用済み）で、急ぎの時刻が後の記録と同じなら急ぎでない
    expect(decideRefetch({ now: 40_000, changedAt: 30_000, urgentAt: 2, current: null, previous: current }).spend).toBeNull();
    expect(decideRefetch({ now: 40_000, changedAt: 30_000, urgentAt: 3, current: null, previous: current }).spend).toBe("current");
    expect(decideRefetch({ now: 40_000, changedAt: 30_000, urgentAt: 3, current: null, previous }).spend).toBe("current");
  });

  it("変わり続けても、1時間の取り直しは最大62回（間隔を15秒 → 30秒 → 60秒と延ばしていたときの上限と同じ）", () => {
    // 前の決まり：静かなあとの最初の変化を0秒として、0・15・45・105・165…秒に取り直す（1時間で62回）
    const before = (seconds: number) => (seconds < 15 ? 1 : seconds < 45 ? 2 : 3 + Math.floor((seconds - 45) / 60));
    expect(before(3599)).toBe(62);
    // 区切りの中のどこで始まっても上限は同じ（0秒・30秒・59秒から始める）
    for (const offset of [0, 30_000, 59_000]) {
      for (const urgent of [true, false]) {
        const records = new Map<number, RefetchRecord>();
        let fetched = 0;
        for (let elapsed = 0; elapsed < 3_600_000; elapsed += 1000) {
          const now = 100 * P + offset + elapsed;
          const period = refetchPeriod(now);
          // 毎秒変わる。急ぎの知らせなら、急ぎの時刻も毎秒変わる
          const decided = decideRefetch({
            now,
            changedAt: now,
            urgentAt: urgent ? now : 1,
            current: records.get(period) ?? null,
            previous: records.get(period - 1) ?? null,
          });
          if (decided.spend) {
            const index = decided.spend === "current" ? period : period - 1;
            // 1回分は1回しか使わない
            expect(records.has(index)).toBe(false);
            records.set(index, { changedAt: now, urgentAt: urgent ? now : 1, at: now });
            fetched += 1;
          }
          // 急ぎでない知らせだけなら、どの時点でも前の決まりの回数以下。
          // 急ぎの知らせが続くときは、残してある1回分が先に出る分だけ（1回）早いことがある
          if (elapsed >= 15_000) expect(fetched).toBeLessThanOrEqual(before(elapsed / 1000) + (urgent ? 1 : 0));
        }
        expect(fetched).toBeLessThanOrEqual(62);
        expect(fetched).toBeGreaterThanOrEqual(60);
      }
    }
  });
});
