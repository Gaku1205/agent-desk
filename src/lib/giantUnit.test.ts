import { describe, expect, it } from "vitest";
import { GIANT_UNIT_GAP, inkRightOf, unitLeft, unitShift } from "./giantUnit";

describe("unitLeft", () => {
  it("字面の右端から間6pxに置く", () => {
    expect(GIANT_UNIT_GAP).toBe(6);
    expect(unitLeft(100)).toBe(106);
    expect(unitLeft(0)).toBe(6);
  });

  it("字面の右端が違っても、間は常に同じ", () => {
    for (const ink of [120, 150, 190]) expect(unitLeft(ink) - ink).toBe(6);
  });
});

describe("unitShift", () => {
  it("箱の幅と字面の右端が違うぶんだけ、置き場所から動かす", () => {
    // 箱 200・列の間 6：置き場所は 206。字面の右端 150 なら 156 へ
    expect(unitShift(150, 200, 6)).toBe(-50);
  });

  it("置き場所に動かした位置が、字面の右端＋6になる", () => {
    for (const [ink, box, colGap] of [
      [150, 200, 6],
      [190, 200, 10],
      [80, 80, 6],
    ] as const) {
      expect(box + colGap + unitShift(ink, box, colGap)).toBe(ink + 6);
    }
  });
});

describe("inkRightOf", () => {
  it("字間を字数−1回ぶん引く", () => {
    expect(inkRightOf(100, 2, -10, 2, 2)).toBe(2 + 2 + 100 - 10);
    expect(inkRightOf(100, 2, -10, 1, 2)).toBe(104);
  });

  it("0字でも字間を足さない", () => {
    expect(inkRightOf(0, 0, -10, 0, 0)).toBe(0);
  });
});
