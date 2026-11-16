import { describe, expect, it } from "vitest";
import { applyStepLog, FLOW_STEPS, flowStepLabel, getFlow, isSolidLink, type FlowState } from "./flow";
import type { IssueStatus } from "./status";

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
    holdRequest: null,
    planned: true,
    fixCount: 0,
    verifyingFix: false,
    reviewedClean: true,
    grace: null,
    ...overrides,
  };
}

/** 7つの工程の状態を左から並べた物 */
function states(s: IssueStatus): FlowState[] {
  return getFlow(s).steps.map((step) => step.state);
}

describe("getFlow", () => {
  it("7つの工程を、企画・デザイン・実装・CI・レビュー・修正・公開の順に出す。モデル名は「不明」", () => {
    const flow = getFlow(status({}));
    expect(flow.steps.map((step) => step.name)).toEqual(["企画", "デザイン", "実装", "CI", "レビュー", "修正", "公開"]);
    expect(flow.steps.every((step) => step.model === "不明")).toBe(true);
    expect(FLOW_STEPS).toHaveLength(7);
  });

  it("未着手は、企画が待ちで、全部待ち", () => {
    const flow = getFlow(status({ stage: "notStarted" }));
    expect(flow.at).toBe(0);
    expect(states(status({ stage: "notStarted" }))).toEqual(Array(7).fill("waiting"));
    expect(flow.steps[0].current).toBe(true);
  });

  it("受付中（猶予）と企画中は、企画が進行中", () => {
    expect(states(status({ stage: "notStarted", grace: "intake" }))[0]).toBe("running");
    expect(states(status({ stage: "planning" }))[0]).toBe("running");
  });

  it("AI作業中：企画は成功、デザインは決められないので待ち、実装が進行中", () => {
    expect(states(status({ stage: "implementing" }))).toEqual([
      "done",
      "waiting",
      "running",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
  });

  it("清書していないIssueは、企画も待ち", () => {
    expect(states(status({ stage: "implementing", planned: false }))[0]).toBe("waiting");
  });

  it("PR作成待ち：実装は成功（PRを作成中は進行中、エラーは失敗）", () => {
    expect(states(status({ stage: "prWaiting" }))[2]).toBe("done");
    expect(states(status({ stage: "prWaiting", grace: "creatingPull" }))[2]).toBe("running");
    expect(states(status({ stage: "prWaiting", implementError: true }))[2]).toBe("failed");
  });

  it("CI中・CI失敗・レビュー中", () => {
    expect(getFlow(status({ stage: "ciRunning" })).at).toBe(3);
    expect(states(status({ stage: "ciRunning" }))[3]).toBe("running");
    expect(states(status({ stage: "ciFailed" }))[3]).toBe("failed");
    expect(states(status({ stage: "reviewing" })).slice(2, 5)).toEqual(["done", "done", "running"]);
  });

  it("修正中・修正の確認中は、修正の位置", () => {
    expect(getFlow(status({ stage: "fixing", fixCount: 1 })).at).toBe(5);
    expect(states(status({ stage: "ciRunning", verifyingFix: true, fixCount: 1 }))[5]).toBe("running");
    expect(states(status({ stage: "ciFailed", verifyingFix: true, fixCount: 1 }))[5]).toBe("failed");
    expect(getFlow(status({ stage: "reviewing", verifyingFix: true, fixCount: 1 })).at).toBe(5);
  });

  it("マージ待ち：レビュー前は、レビューが待ち。ほかは成功（直したなら修正まで）", () => {
    const needs = getFlow(status({ stage: "mergeWaiting", mergeWait: "needsReview" }));
    expect(needs.at).toBe(4);
    expect(needs.steps[4].state).toBe("waiting");
    const auto = getFlow(status({ stage: "mergeWaiting", mergeWait: "autoMerge" }));
    expect(auto.at).toBe(4);
    expect(auto.steps[4].state).toBe("done");
    const fixed = getFlow(status({ stage: "mergeWaiting", mergeWait: "hold", fixCount: 2 }));
    expect(fixed.at).toBe(5);
    expect(fixed.steps[5].state).toBe("done");
  });

  it("マージ待ち（ai:hold）：レビューが指摘なしで終わっていなければ、レビューは待ち", () => {
    const hold = getFlow(status({ stage: "mergeWaiting", mergeWait: "hold", reviewedClean: false }));
    expect(hold.at).toBe(4);
    expect(hold.steps[4].state).toBe("waiting");
  });

  it("公開中・公開失敗・公開済み。直していなければ修正は待ち", () => {
    expect(states(status({ stage: "deploying" }))[6]).toBe("running");
    expect(states(status({ stage: "deployFailed" }))[6]).toBe("failed");
    expect(states(status({ stage: "deployed" }))).toEqual(["done", "waiting", "done", "done", "done", "waiting", "done"]);
    expect(states(status({ stage: "deployed", fixCount: 1 }))[5]).toBe("done");
  });

  it("止まったときは、止まる前の段階の位置を失敗にする。前の段階が無ければ企画", () => {
    const flow = getFlow(status({ stage: "stuck", stageBeforeStuck: "ciFailed" }));
    expect(flow.at).toBe(3);
    expect(flow.steps[3].state).toBe("failed");
    expect(getFlow(status({ stage: "stuck" })).at).toBe(0);
  });

  it("やり直し待ちは、前の段階の位置を待ちにする", () => {
    const flow = getFlow(status({ stage: "retrying", stageBeforeRetry: "implementing" }));
    expect(flow.at).toBe(2);
    expect(flow.steps[2].state).toBe("waiting");
  });
});

describe("isSolidLink", () => {
  it("右のブロックが今の位置までの線は実線、それより右は点線", () => {
    const flow = getFlow(status({ stage: "ciRunning" }));
    expect([0, 1, 2, 3, 4, 5].map((index) => isSolidLink(flow, index))).toEqual([true, true, true, false, false, false]);
  });

  it("未着手は全部点線、公開済みは全部実線", () => {
    const start = getFlow(status({}));
    const end = getFlow(status({ stage: "deployed" }));
    expect([0, 1, 2, 3, 4, 5].some((index) => isSolidLink(start, index))).toBe(false);
    expect([0, 1, 2, 3, 4, 5].every((index) => isSolidLink(end, index))).toBe(true);
  });
});

describe("getFlow の分岐", () => {
  it("CI失敗で分岐が付く。CIが失敗していなければ付かない", () => {
    expect(getFlow(status({ stage: "ciFailed" })).branch).toMatchObject({ n: 1, branch: "active" });
    expect(getFlow(status({ stage: "ciRunning" })).branch).toBeNull();
    expect(getFlow(status({ stage: "deployed" })).branch).toBeNull();
  });

  it("修正して通ったら、通らなかった枝になる", () => {
    const flow = getFlow(status({ stage: "mergeWaiting", mergeWait: "autoMerge", fixCount: 2 }));
    expect(flow.branch).toMatchObject({ n: 2, branch: "notTaken" });
  });
});

describe("flowStepLabel", () => {
  it("工程名・状態・モデル名を文字で言う", () => {
    expect(flowStepLabel({ name: "企画", state: "done", model: "不明" })).toBe("企画　成功　モデル 不明");
  });
  it("所要時間があれば足す", () => {
    expect(flowStepLabel({ name: "実装", state: "done", model: "opus", duration: "3分12秒" })).toBe(
      "実装　成功　モデル opus　所要時間 3分12秒",
    );
  });
  it("開始時刻があれば足す", () => {
    expect(
      flowStepLabel({ name: "実装", state: "done", model: "opus", started: "10:01", duration: "52分" }),
    ).toBe("実装　成功　モデル opus　開始 10:01　所要時間 52分");
  });
});

describe("applyStepLog", () => {
  const base = () => getFlow(status({ stage: "ciRunning" }));
  it("記録のある工程にモデル名と所要時間を渡す。null のモデルは不明", () => {
    const flow = applyStepLog(base(), [
      { key: "implement", model: "opus", duration: "3分12秒", started: "10:01" },
      { key: "ci", model: null, duration: "45秒", started: "10:06" },
    ]);
    const get = (key: string) => flow.steps.find((step) => step.key === key);
    expect(get("implement")).toMatchObject({ model: "opus", duration: "3分12秒", started: "10:01" });
    expect(get("ci")).toMatchObject({ model: "不明", duration: "45秒", started: "10:06" });
    expect(get("plan")).toMatchObject({ model: "不明", duration: null, started: null });
  });
  it("記録が無ければそのまま", () => {
    const flow = base();
    expect(applyStepLog(flow, [])).toBe(flow);
    expect(flow.steps.every((step) => step.model === "不明" && step.duration === null)).toBe(true);
  });
});
