import { describe, expect, it } from "vitest";
import { stripCoreSize, stripLight } from "./stripLight";

const m = (who: "human" | "ai" | "queue" | "fail" | "done", urgent = false) => ({ who, urgent });

describe("stripLight", () => {
  it("0件は色が無い（小さな点だけ）", () => {
    expect(stripLight([])).toEqual({ who: null, core: 0, grains: 0, urgent: false });
  });

  it("色はいちばん目立つ物：人間 → 失敗 → AI → 待機 → 公開済み", () => {
    expect(stripLight([m("done"), m("queue"), m("ai"), m("fail"), m("human")]).who).toBe("human");
    expect(stripLight([m("done"), m("queue"), m("ai"), m("fail")]).who).toBe("fail");
    expect(stripLight([m("done"), m("queue"), m("ai")]).who).toBe("ai");
    expect(stripLight([m("done"), m("queue")]).who).toBe("queue");
    expect(stripLight([m("done"), m("done")]).who).toBe("done");
  });

  it("急ぐ物がある列だけ urgent", () => {
    expect(stripLight([m("ai"), m("human")]).urgent).toBe(false);
    expect(stripLight([m("ai"), m("human", true)]).urgent).toBe(true);
    expect(stripLight([m("fail", true)]).urgent).toBe(true);
  });

  it("芯は件数で少しだけ大きくなる（4〜7px）", () => {
    expect([1, 2, 3, 4, 6, 7, 30].map(stripCoreSize)).toEqual([4, 5, 5, 6, 6, 7, 7]);
  });

  it("粒は件数が多いほど増え、上限がある", () => {
    const one = stripLight([m("human")]).grains;
    const three = stripLight([m("human"), m("human"), m("human")]).grains;
    const many = stripLight(Array.from({ length: 50 }, () => m("human"))).grains;
    expect(one).toBe(39);
    expect(three).toBe(43);
    expect(many).toBe(51);
  });

  it("粒の基本は以前の1.5倍", () => {
    expect(stripLight([m("ai")]).grains).toBe(36);
    expect(stripLight([m("fail")]).grains).toBe(24);
    expect(stripLight([m("queue")]).grains).toBe(24);
    expect(stripLight([m("done")]).grains).toBe(30);
  });
});
