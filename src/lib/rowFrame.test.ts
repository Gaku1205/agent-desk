import { describe, expect, it } from "vitest";
import { rowFrame, rowFrameAttr } from "./rowFrame";
import type { Stage, Turn } from "./status";

const frameOf = (stage: Stage, turn: Turn) => rowFrame({ stage, turn });

describe("rowFrame", () => {
  it.each<[Stage, Turn]>([
    ["planning", "ai"],
    ["implementing", "ai"],
    ["ciRunning", "ai"],
    ["reviewing", "ai"],
    ["fixing", "ai"],
    ["deploying", "none"],
  ])("%s は回す", (stage, turn) => {
    expect(frameOf(stage, turn)).toEqual({ kind: "spinning" });
  });

  it.each<[Stage, Turn]>([
    ["stuck", "human"],
    ["prWaiting", "human"],
    ["mergeWaiting", "human"],
    ["notStarted", "human"],
  ])("%s（人間の番）は human の外枠", (stage, turn) => {
    expect(frameOf(stage, turn)).toEqual({ kind: "stopped", color: "human" });
  });

  it.each<[Stage, Turn]>([
    ["ciFailed", "ai"],
    ["deployFailed", "human"],
  ])("%s は fail の外枠", (stage, turn) => {
    expect(frameOf(stage, turn)).toEqual({ kind: "stopped", color: "fail" });
  });

  it.each<[Stage, Turn]>([
    ["deployed", "none"],
    ["mergeWaiting", "ai"],
  ])("%s は外枠を出さない", (stage, turn) => {
    expect(frameOf(stage, turn)).toEqual({ kind: "none" });
  });

  it("queued は順番待ちの外枠", () => {
    expect(frameOf("queued", "none")).toEqual({ kind: "queue" });
  });

  it("retrying は順番待ちと同じ控えめな外枠", () => {
    expect(frameOf("retrying", "none")).toEqual({ kind: "queue" });
  });

  it("data-frame の値", () => {
    expect(rowFrameAttr({ kind: "queue" })).toBe("queue");
    expect(rowFrameAttr({ kind: "spinning" })).toBe("spinning");
    expect(rowFrameAttr({ kind: "stopped", color: "human" })).toBe("human");
    expect(rowFrameAttr({ kind: "stopped", color: "fail" })).toBe("fail");
    expect(rowFrameAttr({ kind: "none" })).toBeUndefined();
  });
});
