import { describe, expect, it } from "vitest";
import { limitsSummary, observedHours, type RateSample } from "./githubLimits";
import {
  emptyStore,
  isCheckDue,
  mergeChain,
  mergeStore,
  parseStore,
  RATE_HISTORY_MAX_BYTES,
  serializeStore,
  shouldWriteStore,
  storeUsed,
  type LiveRateHistories,
} from "./rateHistoryStore";
import { hourStarts } from "./githubLimits";

const HOUR = 3_600_000;
// 2026-11-18 02:30 UTC = 11:30 JST
const NOW = Date.UTC(2026, 10, 18, 2, 30);
const RESET = Math.floor(NOW / 1000) + 1800;

function sample(minutesAgo: number, remaining: number, resetAt: number | null = RESET): RateSample {
  return { at: NOW - minutesAgo * 60_000, remaining, resetAt };
}

describe("mergeChain", () => {
  it("保存が無ければ、メモリの点から枠と最後の点を作る", () => {
    const chain = mergeChain(undefined, [sample(20, 4000), sample(10, 3900), sample(0, 3700)], NOW);
    expect(chain.used[String(Date.UTC(2026, 10, 18, 2))]).toBe(300);
    expect(chain.last).toEqual(sample(0, 3700));
  });

  it("保存した最後の点より前の点は足さない（二重に数えない）", () => {
    const points = [sample(20, 4000), sample(10, 3900), sample(0, 3700)];
    const once = mergeChain(undefined, points, NOW);
    const twice = mergeChain(once, points, NOW);
    expect(twice).toEqual(once);
  });

  it("保存の最後の点と、新しい点の間の減りも数える", () => {
    const stored = mergeChain(undefined, [sample(20, 4000), sample(10, 3900)], NOW);
    const merged = mergeChain(stored, [sample(10, 3900), sample(0, 3800)], NOW);
    expect(merged.used[String(Date.UTC(2026, 10, 18, 2))]).toBe(200);
    expect(merged.last?.remaining).toBe(3800);
  });

  it("25枠より古い枠と古い最後の点は捨てる", () => {
    const old = { used: { [String(NOW - 30 * HOUR)]: 100 }, last: sample(30 * 60, 100) };
    const merged = mergeChain(old, [], NOW);
    expect(merged.used).toEqual({});
    expect(merged.last).toBeNull();
  });
});

describe("保存→読み直し（サーバーが入れ替わっても残る）", () => {
  it("書いた文字列を別のサーバーが読み直すと、直近24時間ぶんが残る", () => {
    const live: LiveRateHistories = {
      rest: { "app-1": [sample(90, 5000), sample(80, 4900), sample(30, 4700), sample(0, 4500)] },
      graphql: {},
    };
    const written = serializeStore(mergeStore(emptyStore(), live, NOW));
    expect(written).not.toBeNull();
    // 別のサーバー：メモリは空で、保存だけを読む
    const reread = parseStore(written);
    const used = storeUsed(reread, "rest", NOW);
    expect(used).toHaveLength(24);
    expect(used[23]).toBe(400);
    expect(used[22]).toBe(100);
    expect(used[0]).toBeNull();
  });

  it("別のサーバーの分と合わせても、同じ点を二重に数えない", () => {
    const a: LiveRateHistories = { rest: { "app-1": [sample(30, 4800), sample(20, 4700)] }, graphql: {} };
    const stored = mergeStore(emptyStore(), a, NOW);
    const b: LiveRateHistories = { rest: { "app-1": [sample(30, 4800), sample(20, 4700), sample(0, 4500)] }, graphql: {} };
    const merged = mergeStore(stored, b, NOW);
    expect(storeUsed(merged, "rest", NOW)[23]).toBe(300);
  });

  it("鍵が複数あれば枠ごとに足す", () => {
    const live: LiveRateHistories = {
      rest: {},
      graphql: {
        user: [sample(10, 4000), sample(0, 3900)],
        "app-1": [sample(10, 3000), sample(0, 2800)],
      },
    };
    expect(storeUsed(mergeStore(emptyStore(), live, NOW), "graphql", NOW)[23]).toBe(300);
  });
});

describe("保存する中身", () => {
  it("トークン・ハッシュ・秘密らしい物が入らず、48KB に収まる", () => {
    const points: RateSample[] = Array.from({ length: 2000 }, (_, i) => ({
      at: NOW - (2000 - i) * 40_000,
      remaining: 5000 - (i % 50),
      resetAt: RESET,
    }));
    const live: LiveRateHistories = {
      rest: { "app-1": points, "app-2": points },
      graphql: { user: points, "app-1": points, "app-2": points },
    };
    const text = serializeStore(mergeStore(emptyStore(), live, NOW));
    expect(text).not.toBeNull();
    expect(new TextEncoder().encode(text ?? "").length).toBeLessThan(RATE_HISTORY_MAX_BYTES);
    expect(text).not.toMatch(/ghp_|ghs_|token|sha256|[0-9a-f]{40}/i);
    expect(Object.keys(JSON.parse(text ?? "{}"))).toEqual(["v", "rest", "graphql"]);
  });

  it("48KB を超える中身は書かない（null）", () => {
    const used: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) used[String(1_000_000_000_000 + i)] = 123456789;
    expect(serializeStore({ v: 1, rest: { a: { used, last: null } }, graphql: {} })).toBeNull();
  });

  it("壊れた・形が違う・空の中身は空として読む", () => {
    expect(parseStore(null)).toEqual(emptyStore());
    expect(parseStore("{")).toEqual(emptyStore());
    expect(parseStore('{"v":2}')).toEqual(emptyStore());
    expect(parseStore('{"v":1,"rest":{"a":{"used":{"1":"x"},"last":5}}}').rest.a).toEqual({ used: {}, last: null });
  });
});

describe("shouldWriteStore / isCheckDue", () => {
  const base = { nowMs: NOW, previous: "a", next: "b" };
  it("まだ確かめていなければ、変わっていれば書く", () => {
    expect(shouldWriteStore({ ...base, lastCheckedAt: null })).toBe(true);
  });
  it("前から10分たっていなければ書かない", () => {
    expect(shouldWriteStore({ ...base, lastCheckedAt: NOW - 9 * 60_000 })).toBe(false);
    expect(isCheckDue(NOW - 9 * 60_000, NOW)).toBe(false);
  });
  it("10分以上たっていて変わっていれば書く", () => {
    expect(shouldWriteStore({ ...base, lastCheckedAt: NOW - 10 * 60_000 })).toBe(true);
    expect(isCheckDue(NOW - 10 * 60_000, NOW)).toBe(true);
  });
  it("変わっていなければ書かない", () => {
    expect(shouldWriteStore({ ...base, next: "a", lastCheckedAt: null })).toBe(false);
  });
  it("上限を超える中身（null）は書かない", () => {
    expect(shouldWriteStore({ ...base, next: null, lastCheckedAt: null })).toBe(false);
  });
});

describe("記録が24時間に満たないときのまとめの文", () => {
  const starts = hourStarts(NOW);
  const series = (filledLast: number, value = 100): (number | null)[] =>
    starts.map((_, i) => (i >= starts.length - filledLast ? value : null));
  const none = series(0);

  it("observedHours は、記録のある最初の枠から今の枠まで", () => {
    expect(observedHours(series(5), none)).toBe(5);
    expect(observedHours(none, none)).toBe(0);
    expect(observedHours(series(24))).toBe(24);
  });

  it("5時間分なら、何時間分を見たかを言う", () => {
    expect(limitsSummary(starts, series(5), none)).toBe(
      "記録があるのは直近 5 時間分だけです。その間、上限 5,000 を超えた時間帯はありません。",
    );
  });

  it("超えた枠があれば、見た時間の後に書く", () => {
    expect(limitsSummary(starts, series(5, 6000), none)).toBe(
      "記録があるのは直近 5 時間分だけです。上限 5,000 を超えた時間帯があります：Pipeline 07時台・08時台・09時台・10時台・11時台。",
    );
  });

  it("24時間ぶんそろっていれば今までの文", () => {
    expect(limitsSummary(starts, series(24), none)).toBe("この24時間、上限 5,000 を超えた時間帯はありません。");
  });

  it("記録が全く無ければ履歴がまだありません", () => {
    expect(limitsSummary(starts, none, none)).toContain("履歴がまだありません");
  });
});
