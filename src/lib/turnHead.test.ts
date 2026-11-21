import { describe, expect, it } from "vitest";
import { turnHeadCells, turnHeadId, turnHeadText } from "./turnHead";

describe("turnHeadId", () => {
  it("PR が無ければ repo#番号、あれば PR も続ける", () => {
    expect(turnHeadId({ repo: "todo-app", number: 23, pullOnly: false, pullNumber: null })).toBe("todo-app#23");
    expect(turnHeadId({ repo: "todo-app", number: 23, pullOnly: false, pullNumber: 38 })).toBe("todo-app#23 PR #38");
    expect(turnHeadId({ repo: "todo-app", number: 38, pullOnly: true, pullNumber: null })).toBe("todo-app PR #38");
  });
});

describe("turnHeadCells", () => {
  it("無い項目は入れない（` · ` が余らない）", () => {
    expect(turnHeadCells({ hasName: false, source: null })).toEqual(["id", "wait"]);
    expect(turnHeadCells({ hasName: true, source: null })).toEqual(["id", "name", "wait"]);
    expect(turnHeadCells({ hasName: false, source: "企画AIから" })).toEqual(["id", "source", "wait"]);
  });
});

describe("turnHeadText", () => {
  it("項目の間を ` · ` でつなぐ", () => {
    expect(
      turnHeadText({ group: "Fix", id: "todo-app#23 PR #38", name: "通知の音", source: null, wait: "46分" }),
    ).toBe("Fix · todo-app#23 PR #38 · 通知の音 · 46分");
    expect(
      turnHeadText({ group: "Answer", id: "landing-page#18", name: null, source: "企画AIから", wait: "5分" }),
    ).toBe("Answer · landing-page#18 · 企画AIから · 5分");
  });
});
