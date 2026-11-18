import { describe, expect, it } from "vitest";
import { splitPhrases, TURN_GROUPS, turnKind } from "./turnKind";

describe("turnKind", () => {
  it("8つの種類は、英語の名前・まとまり・記号が決まっている", () => {
    expect(turnKind({ stage: "stuck" })).toEqual({ label: "Stuck", group: "fix", icon: "stuck" });
    expect(turnKind({ stage: "deployFailed" })).toEqual({ label: "Deploy failed", group: "fix", icon: "deployFailed" });
    expect(turnKind({ stage: "question" })).toEqual({ label: "Question", group: "answer", icon: "question" });
    expect(turnKind({ stage: "factoryTalk" })).toEqual({ label: "Factory talk", group: "answer", icon: "factoryTalk" });
    expect(turnKind({ stage: "mergeWaiting" })).toEqual({ label: "Merge", group: "ship", icon: "merge" });
    expect(turnKind({ stage: "prWaiting" })).toEqual({ label: "PR pending", group: "ship", icon: "prPending" });
    expect(turnKind({ stage: "notStarted" })).toEqual({ label: "Not started", group: "start", icon: "notStarted" });
    expect(turnKind({ stage: "skipped" })).toEqual({ label: "On hold", group: "start", icon: "onHold" });
  });

  it("8つの種類の名前と記号は、どれも重ならない", () => {
    const stages = [
      "stuck",
      "deployFailed",
      "question",
      "factoryTalk",
      "mergeWaiting",
      "prWaiting",
      "notStarted",
      "skipped",
    ] as const;
    const kinds = stages.map((stage) => turnKind({ stage }));
    expect(new Set(kinds.map((k) => k.label)).size).toBe(8);
    expect(new Set(kinds.map((k) => k.icon)).size).toBe(8);
    // どのまとまりにも2つずつ
    for (const { group } of TURN_GROUPS) expect(kinds.filter((k) => k.group === group)).toHaveLength(2);
  });

  it("猶予の間（パイプラインが自動で進める）は「PRを作成中」「受付中」", () => {
    expect(turnKind({ stage: "prWaiting", grace: "creatingPull" }).label).toBe("PRを作成中");
    expect(turnKind({ stage: "notStarted", grace: "intake" }).label).toBe("受付中");
    expect(turnKind({ stage: "prWaiting", grace: null }).label).toBe("PR pending");
  });

  it("凡例は Fix・Answer・Ship・Start の順", () => {
    expect(TURN_GROUPS.map((g) => g.label)).toEqual(["Fix", "Answer", "Ship", "Start"]);
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
