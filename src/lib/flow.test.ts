import { describe, expect, it } from "vitest";
import { applyStepLog, FLOW_STEPS, flowStepLabel, getFlow, isSolidLink, stepDetail, type FlowState } from "./flow";
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
  it("7つの工程を、企画・デザイン・実装・CI・レビュー・修正・公開の順に出す。モデル名は読み込み中（null）", () => {
    const flow = getFlow(status({}));
    expect(flow.steps.map((step) => step.name)).toEqual(["企画", "デザイン", "実装", "CI", "レビュー", "修正", "公開"]);
    expect(flow.steps.every((step) => step.model === null)).toBe(true);
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
    // エラー直後の猶予の間は進行中（猶予が優先）
    expect(states(status({ stage: "prWaiting", implementError: true, grace: "creatingPull" }))[2]).toBe("running");
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

describe("stepDetail（2行目：モデル名と所要時間。Issue #720）", () => {
  const base = { state: "done" as const, current: false, model: "opus", duration: "3分12秒" };
  it("AI の工程はモデル名と所要時間", () => {
    expect(stepDetail({ key: "implement", ...base })).toBe("opus · 3分12秒");
  });
  it("始まっていない工程（待ちで、今の位置でない）は2行目を出さない", () => {
    expect(stepDetail({ key: "design", state: "waiting", current: false, model: "不明", duration: null })).toBeNull();
    expect(stepDetail({ key: "implement", state: "waiting", current: false, model: null, duration: null })).toBeNull();
  });
  it("待ちでも今の位置の工程は2行目を出す", () => {
    expect(stepDetail({ key: "review", state: "waiting", current: true, model: "opus", duration: "1分" })).toBe(
      "opus · 1分",
    );
  });
  it("CI・公開はモデル名を出さず、時間だけ", () => {
    expect(stepDetail({ key: "ci", ...base, model: "不明", duration: "4分2秒" })).toBe("4分2秒");
    expect(stepDetail({ key: "deploy", ...base, model: "opus", duration: "2分" })).toBe("2分");
  });
  it("モデルが分からない（不明）AI の工程は時間だけ", () => {
    expect(stepDetail({ key: "plan", ...base, model: "不明" })).toBe("3分12秒");
  });
  it("モデルも時間も無ければ null（読み込み中の null も出さない）", () => {
    expect(stepDetail({ key: "plan", state: "done", current: false, model: "不明", duration: null })).toBeNull();
    expect(stepDetail({ key: "plan", state: "done", current: false, model: null, duration: null })).toBeNull();
  });
});

describe("flowStepLabel", () => {
  it("工程名・状態を文字で言う。記録が無いモデル（不明）は言わない", () => {
    expect(flowStepLabel({ name: "企画", state: "done", model: "不明" })).toBe("企画　成功");
  });
  it("CI は名前の後ろに説明を添えて言う（工程の名前は CI のまま。Issue #743）", () => {
    expect(flowStepLabel({ key: "ci", name: "CI", state: "done", model: null, duration: "4分2秒" })).toBe(
      "CI（自動のチェック）　成功　所要時間 4分2秒",
    );
  });
  it("読み込み中（モデル名が null）は「モデル」を言わない", () => {
    expect(flowStepLabel({ name: "企画", state: "done", model: null })).toBe("企画　成功");
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
  it("記録が0件でも、読み込み中が外れて全部「不明」になる", () => {
    const flow = base();
    expect(flow.steps.every((step) => step.model === null)).toBe(true);
    const settled = applyStepLog(flow, []);
    expect(settled.steps.every((step) => step.model === "不明" && step.duration === null)).toBe(true);
  });
});
