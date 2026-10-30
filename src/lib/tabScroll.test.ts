import { describe, expect, it } from "vitest";
import { revealScrollLeft } from "./tabScroll";

const base = { scrollLeft: 0, viewportWidth: 400, scrollWidth: 1000, itemWidth: 100, edge: 20 };

describe("revealScrollLeft", () => {
  it("見えている札なら動かない", () => {
    expect(revealScrollLeft({ ...base, itemLeft: 100 })).toBe(0);
  });
  it("右にはみ出す札は、右端から edge 空けて見える位置へ", () => {
    expect(revealScrollLeft({ ...base, itemLeft: 500 })).toBe(220);
  });
  it("左にはみ出す札は、左端から edge 空けて見える位置へ", () => {
    expect(revealScrollLeft({ ...base, scrollLeft: 600, itemLeft: 300 })).toBe(280);
  });
  it("スクロールできる範囲を超えない", () => {
    expect(revealScrollLeft({ ...base, itemLeft: 900 })).toBe(600);
    expect(revealScrollLeft({ ...base, scrollLeft: 50, itemLeft: 0 })).toBe(0);
  });
  it("札が入りきるときは 0", () => {
    expect(revealScrollLeft({ ...base, scrollWidth: 400, itemLeft: 300 })).toBe(0);
  });
});
