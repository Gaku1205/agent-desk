import { describe, expect, it } from "vitest";
import { BREAKDOWN_MAX_PX, BREAKDOWN_MIN_PX, repoBreakdown } from "./breakdown";

describe("repoBreakdown", () => {
  it("件数の多い順に並べ、いちばん多い物が最大、ほかは件数に比べた大きさ", () => {
    const rows = repoBreakdown([
      { repo: "landing-page", count: 3 },
      { repo: "todo-app", count: 5 },
    ]);
    expect(rows.map((r) => r.repo)).toEqual(["todo-app", "landing-page"]);
    expect(rows[0].size).toBe(BREAKDOWN_MAX_PX);
    expect(rows[1].size).toBeCloseTo(22 + (34 * 3) / 5, 1);
  });

  it("0件は最小の大きさ。同じ件数なら名前の順", () => {
    const rows = repoBreakdown([
      { repo: "b", count: 0 },
      { repo: "a", count: 0 },
      { repo: "c", count: 2 },
    ]);
    expect(rows.map((r) => r.repo)).toEqual(["c", "a", "b"]);
    expect(rows[1].size).toBe(BREAKDOWN_MIN_PX);
  });

  it("全部0件・空でも壊れない", () => {
    expect(repoBreakdown([{ repo: "a", count: 0 }])).toEqual([{ repo: "a", count: 0, size: BREAKDOWN_MIN_PX }]);
    expect(repoBreakdown([])).toEqual([]);
  });
});
