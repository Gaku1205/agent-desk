import { describe, expect, it } from "vitest";
import { isNavKey, nextByArrow, pickTabStop, type NavBox } from "./navigate";

// 3列 × 縦に並んだ名札
const boxes: NavBox[] = [
  { key: "a1", x: 100, y: 40 },
  { key: "a2", x: 100, y: 110 },
  { key: "b1", x: 300, y: 70 },
  { key: "c1", x: 500, y: 40 },
  { key: "c2", x: 500, y: 150 },
];

describe("nextByArrow", () => {
  it("→ ← は横に一番近い物（縦のずれが小さい物）へ", () => {
    expect(nextByArrow(boxes, "a1", "ArrowRight")).toBe("b1");
    expect(nextByArrow(boxes, "b1", "ArrowRight")).toBe("c1");
    expect(nextByArrow(boxes, "b1", "ArrowLeft")).toBe("a1");
    expect(nextByArrow(boxes, "c2", "ArrowLeft")).toBe("b1");
  });

  it("↑ ↓ は同じ列の、縦に一番近い物へ", () => {
    expect(nextByArrow(boxes, "a1", "ArrowDown")).toBe("a2");
    expect(nextByArrow(boxes, "c2", "ArrowUp")).toBe("c1");
  });

  it("動ける先が無ければ null（そのまま）", () => {
    expect(nextByArrow(boxes, "a1", "ArrowLeft")).toBeNull();
    expect(nextByArrow(boxes, "c2", "ArrowDown")).toBeNull();
    expect(nextByArrow(boxes, "c1", "ArrowRight")).toBeNull();
  });

  it("Home は左上、End は右下", () => {
    expect(nextByArrow(boxes, "b1", "Home")).toBe("a1");
    expect(nextByArrow(boxes, "b1", "End")).toBe("c2");
    expect(nextByArrow(boxes, "a1", "Home")).toBeNull();
  });

  it("知らないキーの物・空の並びは null", () => {
    expect(nextByArrow(boxes, "zz", "ArrowRight")).toBeNull();
    expect(nextByArrow([], "a1", "ArrowRight")).toBeNull();
  });

  it("同じ高さの物どうしでも、ほぼ同じ位置（4px以内）は向きの候補にしない", () => {
    const close: NavBox[] = [
      { key: "x", x: 100, y: 40 },
      { key: "y", x: 102, y: 40 },
      { key: "z", x: 200, y: 40 },
    ];
    expect(nextByArrow(close, "x", "ArrowRight")).toBe("z");
  });
});

describe("isNavKey", () => {
  it("矢印・Home・End だけ", () => {
    expect(isNavKey("ArrowLeft")).toBe(true);
    expect(isNavKey("Home")).toBe(true);
    expect(isNavKey("Tab")).toBe(false);
    expect(isNavKey("Enter")).toBe(false);
  });
});

describe("pickTabStop", () => {
  it("選んでいる物が見えていればそれ、見えなければ見えている先頭", () => {
    const keys = ["a", "b", "c"];
    expect(pickTabStop(keys, new Set(["a", "b", "c"]), "b")).toBe("b");
    expect(pickTabStop(keys, new Set(["b", "c"]), "a")).toBe("b");
    expect(pickTabStop(keys, new Set(["c"]), null)).toBe("c");
  });

  it("見えている物が無ければ null", () => {
    expect(pickTabStop(["a"], new Set(), "a")).toBeNull();
    expect(pickTabStop([], new Set(), null)).toBeNull();
  });
});
