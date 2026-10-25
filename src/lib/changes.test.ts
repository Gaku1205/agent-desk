import { describe, expect, it } from "vitest";
import { shouldFadeIn, stageChanged } from "./changes";

describe("stageChanged", () => {
  it("段階が違えば変わった", () => {
    expect(stageChanged("reviewing", "mergeWaiting")).toBe(true);
  });

  it("同じ段階なら変わっていない", () => {
    expect(stageChanged("reviewing", "reviewing")).toBe(false);
  });

  it("前の段階が無い（初めて見る）なら変わった扱いにしない", () => {
    expect(stageChanged(null, "reviewing")).toBe(false);
  });
});

describe("shouldFadeIn", () => {
  it("画面を開いた直後（取り直し0回）は光らせない", () => {
    expect(shouldFadeIn(0)).toBe(false);
  });

  it("取り直しの後に入った行はフェードインさせる", () => {
    expect(shouldFadeIn(1)).toBe(true);
    expect(shouldFadeIn(5)).toBe(true);
  });
});
