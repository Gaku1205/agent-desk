import { describe, expect, it } from "vitest";
import { factoryChatText, factoryElapsed, factoryStage } from "./factoryStage";
import type { WorkflowRunData } from "./github/types";

function run(name: string, overrides: Partial<WorkflowRunData> = {}): WorkflowRunData {
  return {
    id: 1,
    status: "in_progress",
    headBranch: "main",
    displayTitle: name,
    pullNumbers: [],
    updatedAt: "2026-11-19T10:10:00Z",
    name,
    startedAt: "2026-11-19T10:00:00Z",
    ...overrides,
  };
}

const NOW = new Date("2026-11-19T10:12:00Z");
const base = { labels: ["factory", "factory:talk"], state: "open" as const };

describe("factoryStage", () => {
  it("factory:wait が付いていれば相談待ち（動いている実行があっても）", () => {
    const phase = factoryStage({ ...base, labels: [...base.labels, "factory:wait"], runs: [run("Factory talk")] });
    expect(phase.kind).toBe("waiting");
    expect(factoryChatText(phase, NOW)).toBe("工場が相談の答えを待っています。Your turn で選んでください");
  });

  it("Factory talk が動いていれば作業中。ステップ名で段の文が決まる", () => {
    const steps = (name: string) => [{ runId: 1, name, url: null }];
    const at = (name: string) => factoryStage({ ...base, runs: [run("Factory talk")], runSteps: steps(name) });
    expect(at("関門と審査の準備（1 回目）").text).toBe("関門と審査の準備をしています");
    expect(at("審査の結果（2 回目）").text).toBe("審査の結果をまとめています");
    expect(at("Run anthropics/claude-code-action@v1").text).toBe("作っています");
    expect(at("読めない名前").kind).toBe("working");
    expect(factoryStage({ ...base, runs: [run("Factory talk", { status: "queued" })] })).toMatchObject({
      kind: "working",
      text: "作っています",
    });
  });

  it("作業中の文に経過時間が付く", () => {
    const phase = factoryStage({ ...base, runs: [run("Factory talk")] });
    expect(factoryChatText(phase, NOW)).toBe("作っています（12分）。待つだけです");
    expect(factoryChatText(phase, NOW)).not.toContain("相談待ち");
  });

  it("Factory が動いていれば本番を作っている。ジョブ名で段が決まる", () => {
    const at = (jobName?: string) =>
      factoryStage({ ...base, runs: [run("Factory")], runSteps: [{ runId: 1, name: "x", url: null, jobName }] });
    expect(at("plan")).toMatchObject({ kind: "building", text: "企画を作っています" });
    expect(at("design").text).toBe("デザインを作っています");
    expect(at("build").text).toBe("サービスを作っています");
    expect(at("deploy").text).toBe("公開しています");
    expect(at().text).toBe("作っています");
  });

  it("動いている実行が無く Issue が閉じていれば終わった", () => {
    const phase = factoryStage({ ...base, state: "closed", runs: [run("Factory", { status: "completed" })] });
    expect(phase.kind).toBe("done");
  });

  it("ラベルも実行も無ければ、相談待ちと書かず中立な文にする", () => {
    const phase = factoryStage({ ...base, runs: [] });
    expect(phase.kind).toBe("unknown");
    expect(factoryChatText(phase, NOW)).toBe("工場が受け付けています。待つだけです");
  });

  it("実行の一覧が取れていないときはラベルだけで決める", () => {
    expect(factoryStage({ ...base, runs: null }).kind).toBe("unknown");
    expect(factoryStage({ ...base }).kind).toBe("unknown");
    expect(factoryStage({ ...base, labels: ["factory:wait"], runs: null }).kind).toBe("waiting");
  });
});

describe("factoryElapsed", () => {
  it("分・時間・1分未満の形で返す", () => {
    expect(factoryElapsed("2026-11-19T10:00:00Z", NOW)).toBe("12分");
    expect(factoryElapsed("2026-11-19T09:07:00Z", NOW)).toBe("1時間5分");
    expect(factoryElapsed("2026-11-19T10:11:30Z", NOW)).toBe("1分未満");
    expect(factoryElapsed(null, NOW)).toBeNull();
  });
});
