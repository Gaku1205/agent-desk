import { describe, expect, it } from "vitest";
import { getFlow } from "./flow";
import { pickFlowTarget, toggleFlowSelection } from "./flowTarget";
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
    reviewedClean: false,
    grace: null,
    ...overrides,
  };
}

const message = (number: number, running: boolean) => ({
  key: `demo/todo-app#${number}`,
  owner: "demo",
  repo: "todo-app",
  number,
  title: `題名${number}`,
  url: `https://github.com/demo/todo-app/issues/${number}`,
  running,
  flow: getFlow(status({ stage: running ? "implementing" : "deployed" })),
});

describe("pickFlowTarget", () => {
  it("あなたの番の1件があれば、それを描く", () => {
    const target = pickFlowTarget(
      {
        owner: "demo",
        repo: "todo-app",
        issue: { number: 23, title: "通知の音", url: "https://github.com/demo/todo-app/issues/23" },
        status: status({ stage: "stuck", stageBeforeStuck: "ciFailed" }),
      },
      [message(21, true)],
      true,
    );
    expect(target?.label).toBe("todo-app#23");
    expect(target?.title).toBe("通知の音");
    expect(target?.flow.at).toBe(3);
  });

  it("無ければ、動いている物のうち、いちばん新しい（並びの下の）1件", () => {
    const target = pickFlowTarget(null, [message(20, true), message(21, true), message(30, false)], false);
    expect(target?.label).toBe("#21");
    expect(target?.flow.steps[2].state).toBe("running");
  });

  it("どちらも無ければ null", () => {
    expect(pickFlowTarget(null, [], true)).toBeNull();
    expect(pickFlowTarget(null, [message(30, false)], true)).toBeNull();
  });

  const current = {
    owner: "demo",
    repo: "todo-app",
    issue: { number: 23, title: "通知の音", url: "https://github.com/demo/todo-app/issues/23" },
    status: status({ stage: "ciFailed" }),
  };

  it("いまの様子で選んだ行があれば、あなたの番より先にそれを描く（動いていない行でも）", () => {
    const target = pickFlowTarget(current, [message(21, true), message(30, false)], false, "demo/todo-app#30");
    expect(target?.label).toBe("#30");
    expect(target?.flow.at).toBe(6);
  });

  it("選んだ行がもう無ければ、今まで通り", () => {
    expect(pickFlowTarget(current, [message(21, true)], false, "demo/todo-app#99")?.label).toBe("#23");
    expect(pickFlowTarget(null, [message(21, true)], false, "demo/todo-app#99")?.label).toBe("#21");
  });
});

describe("toggleFlowSelection", () => {
  it("ほかの行を選ぶとその行に、同じ行をもう一度選ぶと外す", () => {
    expect(toggleFlowSelection(null, "a#1")).toBe("a#1");
    expect(toggleFlowSelection("a#1", "a#2")).toBe("a#2");
    expect(toggleFlowSelection("a#1", "a#1")).toBeNull();
  });
});
