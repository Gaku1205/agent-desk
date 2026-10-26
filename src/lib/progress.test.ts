import { describe, expect, it } from "vitest";
import { getProgress, toneRgba } from "./progress";
import type { IssueStatus, Stage } from "./status";

function status(overrides: Partial<IssueStatus>): IssueStatus {
  return {
    stage: "notStarted",
    turn: "human",
    stageBeforeStuck: null,
    stageBeforeRetry: null,
    retry: null,
    pull: null,
    ci: { passed: 0, total: 0 },
    mergeWait: null,
    implementError: false,
    deployUnknown: false,
    stuckReason: null,
    planned: true,
    fixCount: 1,
    verifyingFix: false,
    ...overrides,
  };
}

describe("getProgress の位置と色", () => {
  const cases: [Stage, Partial<IssueStatus>, number, string][] = [
    ["notStarted", {}, 0, "human"],
    ["queued", { turn: "none" }, 0, "queue"],
    ["planning", { turn: "ai" }, 0, "ai"],
    ["implementing", { turn: "ai" }, 1, "ai"],
    ["prWaiting", {}, 2, "human"],
    ["ciRunning", { turn: "ai" }, 3, "ai"],
    ["ciFailed", { turn: "ai" }, 3, "fail"],
    ["reviewing", { turn: "ai" }, 4, "ai"],
    ["fixing", { turn: "ai" }, 5, "ai"],
    ["mergeWaiting", { turn: "human", mergeWait: "hold" }, 6, "human"],
    ["mergeWaiting", { turn: "ai", mergeWait: "autoMerge" }, 6, "ai"],
    ["deploying", { turn: "none" }, 7, "ai"],
    ["deployFailed", {}, 7, "fail"],
    ["deployed", { turn: "none" }, 7, "done"],
  ];

  it.each(cases)("%s", (stage, overrides, at, tone) => {
    const progress = getProgress(status({ stage, ...overrides }));
    expect(progress.at).toBe(at);
    expect(progress.tone).toBe(tone);
    expect(progress.bars).toHaveLength(8);
    expect(progress.bars.filter((bar) => bar.current).map((bar) => bar.index)).toEqual([at]);
    progress.bars.forEach((bar) => {
      expect(bar.tone).toBe(bar.index <= at ? tone : null);
    });
  });

  it("やり直し待ちは、元の段階の位置で控えめな色（queue）", () => {
    const progress = getProgress(
      status({ stage: "retrying", turn: "none", stageBeforeRetry: "reviewing" }),
    );
    expect(progress.at).toBe(4);
    expect(progress.tone).toBe("queue");
  });

  it("メモから・指摘なしのマージ待ち", () => {
    const progress = getProgress(
      status({ stage: "mergeWaiting", turn: "human", mergeWait: "hold", fixCount: 0 }),
    );
    expect(progress.bars.map((bar) => bar.opacity)).toEqual([
      0.3, 0.42, 0.53, 0.65, 0.77, 0.88, 1, 1,
    ]);
    expect(progress.bars.map((bar) => bar.outlineOnly)).toEqual([
      false, false, false, false, false, true, false, false,
    ]);
    expect(progress.bars[7].tone).toBeNull();
  });

  it("at が0なら不透明度は1", () => {
    expect(getProgress(status({ stage: "notStarted", planned: false })).bars[0]).toMatchObject({
      opacity: 1,
      outlineOnly: false,
    });
  });

  it("飛ばした清書は枠線だけ", () => {
    const bars = getProgress(status({ stage: "ciRunning", turn: "ai", planned: false })).bars;
    expect(bars[0]).toMatchObject({ outlineOnly: true, opacity: 0.3 });
    expect(bars[1].outlineOnly).toBe(false);
  });

  it("清書した、または at が0なら清書は塗る", () => {
    const planned = getProgress(status({ stage: "ciRunning", turn: "ai", planned: true }));
    expect(planned.bars[0].outlineOnly).toBe(false);
    const atZero = getProgress(status({ stage: "planning", turn: "ai", planned: false }));
    expect(atZero.bars[0].outlineOnly).toBe(false);
  });

  it("飛ばした修正は枠線だけ（マージ以降）", () => {
    const merge = getProgress(status({ stage: "mergeWaiting", turn: "ai", fixCount: 0 })).bars;
    expect(merge[5]).toMatchObject({ outlineOnly: true, opacity: 0.88 });
    const review = getProgress(status({ stage: "reviewing", turn: "ai", fixCount: 0 })).bars;
    expect(review.some((bar) => bar.outlineOnly)).toBe(false);
    const fixed = getProgress(status({ stage: "mergeWaiting", turn: "ai", fixCount: 1 })).bars;
    expect(fixed[5].outlineOnly).toBe(false);
  });

  it("修正の確認中は修正の位置のまま", () => {
    for (const stage of ["ciRunning", "reviewing"] as const) {
      const progress = getProgress(status({ stage, turn: "ai", verifyingFix: true }));
      expect(progress.at).toBe(5);
      expect(progress.tone).toBe("ai");
    }
    const failed = getProgress(status({ stage: "ciFailed", turn: "ai", verifyingFix: true }));
    expect(failed.at).toBe(5);
    expect(failed.tone).toBe("fail");
  });

  it("止まったは止まる前の位置で人間の色", () => {
    const progress = getProgress(status({ stage: "stuck", stageBeforeStuck: "reviewing" }));
    expect(progress.at).toBe(4);
    expect(progress.tone).toBe("human");
  });

  it("公開済みは緑の濃淡で、飛ばした段階は枠線だけ", () => {
    const bars = getProgress(
      status({ stage: "deployed", turn: "none", planned: false, fixCount: 0 }),
    ).bars;
    expect(bars.map((bar) => bar.opacity)).toEqual([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(bars.map((bar) => bar.outlineOnly)).toEqual([
      true, false, false, false, false, true, false, false,
    ]);
    expect(bars.every((bar) => bar.tone === "done")).toBe(true);
  });
});

describe("aria-label", () => {
  it("進み具合 n/8・段階名", () => {
    expect(getProgress(status({ stage: "reviewing", turn: "ai" })).ariaLabel).toBe(
      "進み具合 4/8・レビュー",
    );
    expect(getProgress(status({ stage: "deployed", turn: "none" })).ariaLabel).toBe(
      "進み具合 8/8・公開済み",
    );
  });
});

describe("toneRgba", () => {
  it("RGBに不透明度を付ける", () => {
    expect(toneRgba("human", 0.5)).toBe("rgba(232,163,61,0.5)");
    expect(toneRgba("queue", 1)).toBe("rgba(139,92,246,1)");
  });
});
