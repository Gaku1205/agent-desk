import { describe, expect, it } from "vitest";
import { splitPhrases, turnKind } from "./turnKind";

describe("turnKind", () => {
  it("段階ごとの種類の札", () => {
    expect(turnKind({ stage: "stuck" })).toEqual({ label: "止まった", tone: "human" });
    expect(turnKind({ stage: "skipped" }).label).toBe("保留");
    expect(turnKind({ stage: "notStarted" }).label).toBe("未着手");
    expect(turnKind({ stage: "prWaiting" }).label).toBe("PR作成待ち");
    expect(turnKind({ stage: "mergeWaiting" }).label).toBe("マージ待ち");
    expect(turnKind({ stage: "deployFailed" })).toEqual({ label: "公開失敗", tone: "fail" });
  });
});

describe("splitPhrases", () => {
  it("「。」「、」のあとで分ける", () => {
    expect(splitPhrases("保留中です。準備ができたら「始める」を押してください")).toEqual([
      "保留中です。",
      "準備ができたら「始める」を押してください",
    ]);
    expect(splitPhrases("CI 4/4 通過・マージできます")).toEqual(["CI 4/4 通過・マージできます"]);
    expect(splitPhrases("")).toEqual([]);
  });
});
