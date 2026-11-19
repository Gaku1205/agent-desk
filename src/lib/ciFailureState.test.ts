import { describe, expect, it } from "vitest";
import { ciFailureState, ciFixingText } from "./ciFailureState";

describe("ciFailureState", () => {
  it("修正0回：1回目を動いている", () => {
    expect(ciFailureState({ stage: "ciFailed", stuck: false, fixCount: 0 })).toEqual({ kind: "fixing", n: 1 });
  });

  it("修正の依頼が出て直している間（1回直した）：2回目", () => {
    expect(ciFailureState({ stage: "ciFailed", stuck: false, fixCount: 1 })).toEqual({ kind: "fixing", n: 2 });
    expect(ciFailureState({ stage: "ciFailed", stuck: false, fixCount: 2 })).toEqual({ kind: "fixing", n: 3 });
  });

  it("修正の上限（3回）までCIが失敗：止まった", () => {
    expect(ciFailureState({ stage: "ciFailed", stuck: false, fixCount: 3 })).toEqual({ kind: "stopped" });
    expect(ciFailureState({ stage: "ciFailed", stuck: false, fixCount: 5 })).toEqual({ kind: "stopped" });
  });

  it("ai:stuck：止まった", () => {
    expect(ciFailureState({ stage: "ciFailed", stuck: true, fixCount: 0 })).toEqual({ kind: "stopped" });
  });

  it("CI失敗以外の段階は null", () => {
    expect(ciFailureState({ stage: "ciRunning", stuck: false, fixCount: 0 })).toBeNull();
    expect(ciFailureState({ stage: "fixing", stuck: false, fixCount: 1 })).toBeNull();
  });

  it("文は 「AIが直しています（n/3 回目）」", () => {
    expect(ciFixingText(2)).toBe("AIが直しています（2/3 回目）");
  });
});
