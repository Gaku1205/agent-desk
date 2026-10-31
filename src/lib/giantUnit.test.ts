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

describe("「件」の間（どの数字でも字面の右端から6px）", () => {
  it("1〜9のどの数字でも、描いた字面の右端から6pxになる", () => {
    const letterSpacing = -0.06 * 274;
    // 数字ごとに字面の左右が違う。描くときの左端と、右端の計算で使う左端は同じ
    const glyphs: [number, number][] = [
      [98, 21],
      [150, 4],
      [141, 6],
      [160, 3],
      [139, 8],
      [143, 7],
      [147, 5],
      [138, 9],
      [146, 6],
    ];
    for (const [right, left] of glyphs) {
      const drawnRight = 2 + left + right; // 1桁：描き始めの余白 + 字面の左端 + 右端
      expect(unitLeft(inkRightOf(right, left, letterSpacing, 1, 2)) - drawnRight).toBe(GIANT_UNIT_GAP);
    }
  });

  it("2桁でも、字間を引いた描いた字面の右端から6pxになる", () => {
    const drawnRight = 2 + 5 + 300 - 16;
    expect(unitLeft(inkRightOf(300, 5, -16, 2, 2)) - drawnRight).toBe(6);
  });
});
