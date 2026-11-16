import { describe, expect, it } from "vitest";
import { distanceFromBottom, FOLLOW_THRESHOLD, isNearBottom } from "./followScroll";

describe("distanceFromBottom", () => {
  it("いちばん下までの残り", () => {
    expect(distanceFromBottom(2000, 1100, 900)).toBe(0);
    expect(distanceFromBottom(2000, 800, 900)).toBe(300);
  });

  it("負にはしない（弾んで行き過ぎたとき）", () => {
    expect(distanceFromBottom(2000, 1120, 900)).toBe(0);
  });
});

describe("isNearBottom", () => {
  it("いちばん下なら追従する", () => {
    expect(isNearBottom(2000, 1100, 900)).toBe(true);
  });

  it("しきい値ちょうどは追従し、それより離れたらさかのぼり中", () => {
    expect(FOLLOW_THRESHOLD).toBe(80);
    expect(isNearBottom(2000, 1020, 900)).toBe(true);
    expect(isNearBottom(2000, 1019, 900)).toBe(false);
  });

  it("上で読んでいる間は追従しない", () => {
    expect(isNearBottom(5000, 0, 900)).toBe(false);
  });

  it("ページが画面に収まるときは、いちばん下にいる", () => {
    expect(isNearBottom(600, 0, 900)).toBe(true);
  });
});
