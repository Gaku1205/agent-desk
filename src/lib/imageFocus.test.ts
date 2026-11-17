import { describe, expect, it } from "vitest";
import { focusAfterRemove } from "./imageFocus";

describe("focusAfterRemove", () => {
  it("真ん中を外したら、次の画像（同じ番号）へ", () => {
    expect(focusAfterRemove(1, 2)).toEqual({ kind: "image", index: 1 });
  });
  it("先頭を外したら、新しい先頭へ", () => {
    expect(focusAfterRemove(0, 2)).toEqual({ kind: "image", index: 0 });
  });
  it("最後を外したら、1つ前の画像へ", () => {
    expect(focusAfterRemove(2, 2)).toEqual({ kind: "image", index: 1 });
  });
  it("1枚も残らなければ、画像を付けるへ", () => {
    expect(focusAfterRemove(0, 0)).toEqual({ kind: "attach" });
  });
});
