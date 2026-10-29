import { describe, expect, it } from "vitest";
import { SQUEEZE_FREE, SQUEEZE_MAX, squeezeTowardLabel } from "./squeeze";

describe("squeezeTowardLabel", () => {
  it("近い粒と反対側の粒は、そのまま", () => {
    expect(squeezeTowardLabel(0)).toBe(0);
    expect(squeezeTowardLabel(SQUEEZE_FREE)).toBe(SQUEEZE_FREE);
    expect(squeezeTowardLabel(-30)).toBe(-30);
  });

  it("どんなに遠くても、上限を超えない（名札の番号にかぶらない）", () => {
    for (const d of [10, 14, 21, 27, 60, 400]) {
      expect(squeezeTowardLabel(d)).toBeLessThan(SQUEEZE_MAX + 1e-9);
      expect(squeezeTowardLabel(d)).toBeGreaterThanOrEqual(SQUEEZE_FREE);
    }
    // 大きな画面（sc = 1.5）の最大の半径 14 × 1.5 と、乗せたときの 1.3 倍
    expect(squeezeTowardLabel(14 * 1.5 * 1.3)).toBeLessThan(SQUEEZE_MAX);
  });

  it("遠いほど大きい（順番は入れ替わらない）", () => {
    let prev = -Infinity;
    for (let d = 0; d <= 40; d += 1) {
      const v = squeezeTowardLabel(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
