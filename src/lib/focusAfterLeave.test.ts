import { describe, expect, it } from "vitest";
import { nextRowIndex } from "./focusAfterLeave";

describe("nextRowIndex", () => {
  it("次の行へ移す", () => {
    expect(nextRowIndex([true, false, false], 0)).toBe(1);
  });

  it("畳んでいる行は飛ばす", () => {
    expect(nextRowIndex([true, true, false], 0)).toBe(2);
  });

  it("次が無ければ null（見出しへ）", () => {
    expect(nextRowIndex([true], 0)).toBeNull();
    expect(nextRowIndex([false, true], 1)).toBeNull();
  });

  it("前の行へは戻らない", () => {
    expect(nextRowIndex([false, true, true], 1)).toBeNull();
  });
});
