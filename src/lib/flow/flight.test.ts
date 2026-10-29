import { describe, expect, it } from "vitest";
import { flightColumn } from "./flight";

describe("flightColumn", () => {
  it("操作のあとの段階の列へ飛ぶ", () => {
    expect(flightColumn("plan", 0)).toBe(0);
    expect(flightColumn("start", 0)).toBe(0);
    expect(flightColumn("implement", 0)).toBe(1);
    expect(flightColumn("createPull", 2)).toBe(3);
    expect(flightColumn("requestReview", 6)).toBe(4);
    expect(flightColumn("merge", 6)).toBe(7);
  });

  it("再開は、止まる前の段階の列のまま（0〜7に収める）", () => {
    expect(flightColumn("resume", 5)).toBe(5);
    expect(flightColumn("resume", 9)).toBe(7);
    expect(flightColumn("resume", -1)).toBe(0);
  });
});
