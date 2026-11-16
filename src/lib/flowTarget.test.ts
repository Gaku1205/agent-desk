import { describe, expect, it } from "vitest";
import { getFlow } from "./flow";
import { pickFlowTarget } from "./flowTarget";
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

  it("無ければ、動いている物のうち、いちばん上の1件", () => {
    const target = pickFlowTarget(null, [message(30, false), message(21, true), message(20, true)], false);
    expect(target?.label).toBe("#21");
    expect(target?.flow.steps[2].state).toBe("running");
  });

  it("どちらも無ければ null", () => {
    expect(pickFlowTarget(null, [], true)).toBeNull();
    expect(pickFlowTarget(null, [message(30, false)], true)).toBeNull();
  });
});
