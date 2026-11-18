import { describe, expect, it } from "vitest";
import { addCall, emptyCallTotals, timedCall, withCallLog } from "./callLog";

describe("GitHub の呼び出しを数える", () => {
  it("種類ごとに、回数・合計・いちばん長い1回を足す（負・数でない時間は 0）", () => {
    const totals = emptyCallTotals();
    addCall(totals, "graphql", 120);
    addCall(totals, "graphql", 300);
    addCall(totals, "rest", Number.NaN);
    addCall(totals, "key", -5);
    expect(totals.graphql).toEqual({ count: 2, ms: 420, maxMs: 300 });
    expect(totals.rest).toEqual({ count: 1, ms: 0, maxMs: 0 });
    expect(totals.key).toEqual({ count: 1, ms: 0, maxMs: 0 });
    expect(totals.write.count).toBe(0);
  });

  it("`withCallLog` の中の呼び出しだけを数える（同時に動いた物・失敗した物も）", async () => {
    const outside = await timedCall("rest", async () => "not counted");
    expect(outside).toBe("not counted");
    const { value, calls } = await withCallLog(async () => {
      const results = await Promise.allSettled([
        timedCall("graphql", async () => 1),
        timedCall("graphql", async () => 2),
        timedCall("key", async () => {
          throw new Error("failed");
        }),
      ]);
      return results.map((result) => result.status);
    });
    expect(value).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(calls.graphql.count).toBe(2);
    expect(calls.key.count).toBe(1);
    expect(calls.rest.count).toBe(0);
  });

  it("別々に数えている物は混ざらない", async () => {
    const [a, b] = await Promise.all([
      withCallLog(() => timedCall("rest", async () => null)),
      withCallLog(async () => null),
    ]);
    expect(a.calls.rest.count).toBe(1);
    expect(b.calls.rest.count).toBe(0);
  });
});
