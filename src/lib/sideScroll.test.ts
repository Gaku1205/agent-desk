import { describe, expect, it } from "vitest";
import { hasHiddenBelow } from "./sideScroll";

describe("hasHiddenBelow", () => {
  it("全部入っていれば false", () => {
    expect(hasHiddenBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(false);
  });
  it("下に隠れた札があれば true", () => {
    expect(hasHiddenBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 600 })).toBe(true);
    expect(hasHiddenBelow({ scrollTop: 100, clientHeight: 400, scrollHeight: 600 })).toBe(true);
  });
  it("いちばん下まで来たら false", () => {
    expect(hasHiddenBelow({ scrollTop: 200, clientHeight: 400, scrollHeight: 600 })).toBe(false);
  });
  it("小数のずれ（1px 未満）は無いものとする", () => {
    expect(hasHiddenBelow({ scrollTop: 199.6, clientHeight: 400, scrollHeight: 600 })).toBe(false);
  });
});
