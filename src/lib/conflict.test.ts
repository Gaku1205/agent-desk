import { describe, expect, it } from "vitest";
import { conflictKind, conflictText } from "./conflict";
import type { PullData } from "./github/types";

const pull = (conflicting?: boolean) =>
  ({ conflicting }) as PullData;

describe("conflictKind", () => {
  it("コンフリクトしていなければ null", () => {
    expect(conflictKind({ stage: "mergeWaiting", mergeWait: "autoMerge", pull: pull() })).toBeNull();
    expect(conflictKind({ stage: "mergeWaiting", mergeWait: "autoMerge", pull: pull(false) })).toBeNull();
    expect(conflictKind({ stage: "mergeWaiting", mergeWait: "autoMerge", pull: null })).toBeNull();
  });

  it("AIの番のマージ待ちでコンフリクトなら waiting", () => {
    expect(conflictKind({ stage: "mergeWaiting", mergeWait: "autoMerge", pull: pull(true) })).toBe("waiting");
    expect(conflictKind({ stage: "mergeWaiting", mergeWait: "needsReview", pull: pull(true) })).toBe("waiting");
  });

  it("修正の依頼が出ている段階でコンフリクトなら fixing", () => {
    expect(conflictKind({ stage: "fixing", mergeWait: null, pull: pull(true) })).toBe("fixing");
  });

  it("人間の番（ai:hold）やほかの段階は null", () => {
    expect(conflictKind({ stage: "mergeWaiting", mergeWait: "hold", pull: pull(true) })).toBeNull();
    expect(conflictKind({ stage: "ciRunning", mergeWait: null, pull: pull(true) })).toBeNull();
  });
});

describe("conflictText", () => {
  it("文言", () => {
    expect(conflictText("waiting")).toBe("main とぶつかっています");
    expect(conflictText("fixing")).toBe("main とぶつかり・AIが解消中");
  });
});
