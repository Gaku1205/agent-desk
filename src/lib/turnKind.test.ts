import { describe, expect, it } from "vitest";
import { splitPhrases, turnKind } from "./turnKind";

describe("turnKind", () => {
  it("段階ごとの種類の札", () => {
    expect(turnKind({ stage: "stuck" })).toEqual({ label: "止まった", tone: "human" });
    expect(turnKind({ stage: "skipped" })).toEqual({ label: "保留", tone: "calm" });
    expect(turnKind({ stage: "notStarted" })).toEqual({ label: "未着手", tone: "calm" });
    expect(turnKind({ stage: "prWaiting" })).toEqual({ label: "PR作成待ち", tone: "calm" });
    expect(turnKind({ stage: "mergeWaiting" })).toEqual({ label: "マージ待ち", tone: "calm" });
    expect(turnKind({ stage: "deployFailed" })).toEqual({ label: "公開失敗", tone: "fail" });
  });

  it("猶予の間（パイプラインが自動で進める）は「PRを作成中」「受付中」", () => {
    expect(turnKind({ stage: "prWaiting", grace: "creatingPull" })).toEqual({ label: "PRを作成中", tone: "calm" });
    expect(turnKind({ stage: "notStarted", grace: "intake" })).toEqual({ label: "受付中", tone: "calm" });
    expect(turnKind({ stage: "prWaiting", grace: null })).toEqual({ label: "PR作成待ち", tone: "calm" });
  });

  it("強い色（human・fail）は止まった・公開失敗だけ", () => {
    const stages = ["stuck", "skipped", "notStarted", "prWaiting", "mergeWaiting", "deployFailed"] as const;
    const strong = stages.filter((stage) => turnKind({ stage }).tone !== "calm");
    expect(strong).toEqual(["stuck", "deployFailed"]);
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
