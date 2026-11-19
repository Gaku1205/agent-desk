import { describe, expect, it } from "vitest";
import { factoryProgress, factoryStepLabel, factoryStepSub, findNewRepo, progressDuration } from "./factoryProgress";
import { encodeBase64, encodeFactoryMark, FACTORY_BOT } from "./factoryTalk";
import type { CommentData, WorkflowRunData } from "./github/types";

const OWNER = "demo";
const own = { owner: OWNER, repo: "landing-page" };
// 日本時間 12:00 = 03:00Z
const T = (hhmm: string) => `2026-11-19T${hhmm}:00Z`;
const NOW = new Date(T("04:00"));

let id = 1;
function card(stage: string, at: string): CommentData {
  return { id: id++, issueNumber: 7, author: FACTORY_BOT, body: `x\n${encodeFactoryMark({ stage, round: 1 })}`, createdAt: at };
}
function answer(at: string, action: "pick" | "redo" | "go" = "pick"): CommentData {
  const mark = `<!-- factory-answer:${encodeBase64(JSON.stringify({ action, choice: "1", answers: [], note: "" }))} -->`;
  return { id: id++, issueNumber: 7, author: OWNER, body: `答え\n\n${mark}`, createdAt: at };
}
function run(name: string, extra: Partial<WorkflowRunData> = {}): WorkflowRunData {
  return {
    id: 1,
    status: "in_progress",
    headBranch: "main",
    displayTitle: name,
    pullNumbers: [],
    updatedAt: T("03:59"),
    name,
    startedAt: T("03:50"),
    ...extra,
  };
}
const base = {
  owner: OWNER,
  repo: "landing-page",
  issue: { number: 7, state: "open" as const, labels: ["factory", "factory:talk"], createdAt: T("03:00") },
  now: NOW,
};
const keys = (p: ReturnType<typeof factoryProgress>) => p.steps.map((s) => `${s.key}:${s.state}`);

describe("progressDuration", () => {
  it("既存の書き方に合わせる", () => {
    expect(progressDuration(9 * 60_000)).toBe("9分");
    expect(progressDuration(62 * 60_000)).toBe("1時間2分");
    expect(progressDuration(20_000)).toBe("1分未満");
    expect(progressDuration(0)).toBeNull();
    expect(progressDuration(-5)).toBeNull();
  });
});

describe("factoryProgress", () => {
  it("相談待ち：案のカードが出て答え待ち。段は Your turn の色（waiting）、後ろはまだ", () => {
    const p = factoryProgress({
      ...base,
      issue: { ...base.issue, labels: ["factory", "factory:wait"] },
      comments: [card("ideas", T("03:09"))],
      runs: [],
    });
    expect(keys(p)).toEqual([
      "ideas:waiting",
      "looks:pending",
      "mocks:pending",
      "confirm:pending",
      "repo:pending",
      "design:pending",
      "build:pending",
      "deploy:pending",
    ]);
    // 作業 9分（Issue ができてからカードまで）、待ち 51分（カードから今まで）
    expect(p.steps[0]).toMatchObject({ started: "12:00", work: "9分", wait: "51分" });
    expect(factoryStepLabel(p.steps[0])).toBe("案　Your turn　開始 12:00　待ち 51分　AI 9分");
    expect(factoryStepSub(p.steps[0])).toBe("待ち 51分 · AI 9分");
  });

  it("済んだ段は、相談の待ちと AI の作業を分けて出す", () => {
    const p = factoryProgress({
      ...base,
      comments: [card("ideas", T("03:09")), answer(T("03:19")), card("looks", T("03:31")), answer(T("03:36"))],
      runs: [run("Factory talk", { startedAt: T("03:36") })],
    });
    expect(keys(p).slice(0, 3)).toEqual(["ideas:done", "looks:done", "mocks:running"]);
    expect(p.steps[0]).toMatchObject({ started: "12:00", work: "9分", wait: "10分" });
    expect(p.steps[1]).toMatchObject({ started: "12:19", work: "12分", wait: "5分" });
    // 動いている段：答えから今まで（24分）
    expect(p.steps[2]).toMatchObject({ started: "12:36", work: "24分", wait: null });
  });

  it("全部ちがう（redo）のあとは、同じ段をやり直す。待ちと作業は足し合わせる", () => {
    const p = factoryProgress({
      ...base,
      comments: [card("ideas", T("03:10")), answer(T("03:20"), "redo"), card("ideas", T("03:30")), answer(T("03:35"), "redo")],
      runs: [run("Factory talk")],
    });
    expect(keys(p)[0]).toBe("ideas:running");
    expect(p.steps[0].wait).toBe("15分");
  });

  it("画面案が無い設定（最終確認まで画面案のカードが無い）なら7段", () => {
    const p = factoryProgress({
      ...base,
      issue: { ...base.issue, labels: ["factory:wait"] },
      comments: [card("ideas", T("03:09")), answer(T("03:10")), card("looks", T("03:20")), answer(T("03:21")), card("confirm", T("03:30"))],
      runs: [],
    });
    expect(p.steps.map((s) => s.key)).toEqual(["ideas", "looks", "confirm", "repo", "design", "build", "deploy"]);
    expect(p.steps[2].state).toBe("waiting");
  });

  it("まだ画面案の有無が分からない間は8段（画面案を含む）", () => {
    const p = factoryProgress({ ...base, comments: [], runs: [run("Factory talk")] });
    expect(p.steps.map((s) => s.key)).toContain("mocks");
    expect(keys(p)[0]).toBe("ideas:running");
  });

  it("本番を作っている間：リポジトリ・デザイン・作る・公開の今のジョブが動いている", () => {
    const comments = [card("confirm", T("03:30")), answer(T("03:32"), "go")];
    const p = factoryProgress({
      ...base,
      comments,
      runs: [run("Factory", { id: 5 })],
      runSteps: [{ runId: 5, name: "s", url: null, jobName: "build" }],
    });
    expect(keys(p).slice(2)).toEqual(["confirm:done", "repo:done", "design:done", "build:running", "deploy:pending"]);
    expect(p.steps.find((s) => s.key === "repo")?.started).toBe("12:50");
  });

  it("閉じて本番が終わった Issue は全部済み。公開の時刻と、作るの所要時間を出す", () => {
    const p = factoryProgress({
      ...base,
      issue: { ...base.issue, state: "closed" },
      comments: [card("confirm", T("03:30")), answer(T("03:32"), "go")],
      runs: [run("Factory", { status: "completed", startedAt: T("03:00"), updatedAt: T("03:58") })],
    });
    expect(p.steps.every((s) => s.state === "done")).toBe(true);
    expect(p.steps.find((s) => s.key === "build")?.work).toBe("58分");
    expect(p.steps.find((s) => s.key === "deploy")?.started).toBe("12:58");
  });

  it("実行が取れていないときも、不明の段は出さず、相談した所までを済みにする", () => {
    const p = factoryProgress({
      ...base,
      comments: [card("ideas", T("03:09")), answer(T("03:10")), card("looks", T("03:20"))],
      runs: null,
    });
    expect(keys(p).slice(0, 3)).toEqual(["ideas:done", "looks:done", "mocks:pending"]);
  });

  it("本番の実行が失敗して終わり Issue が開いたままなら、公開は済みにしない", () => {
    const p = factoryProgress({
      ...base,
      comments: [card("confirm", T("03:30")), answer(T("03:32"), "go")],
      runs: [run("Factory", { status: "completed", conclusion: "failure", startedAt: T("03:40"), updatedAt: T("03:50") })],
    });
    expect(p.steps.find((s) => s.key === "deploy")?.state).not.toBe("done");
    expect(p.steps.find((s) => s.key === "build")?.state).not.toBe("done");
    expect(p.steps.find((s) => s.key === "confirm")?.state).toBe("done");
  });

  it("go と答えた直後で実行が無いときも、公開は済みにしない", () => {
    const p = factoryProgress({
      ...base,
      comments: [card("confirm", T("03:30")), answer(T("03:32"), "go")],
      runs: null,
    });
    expect(p.steps.find((s) => s.key === "deploy")?.state).toBe("pending");
  });
});

describe("findNewRepo", () => {
  const report = (body: string): CommentData => ({ id: 99, issueNumber: 7, author: FACTORY_BOT, body, createdAt: T("03:58") });

  it("工場の結果のコメントの新しいリポジトリを見つける。工場のあるリポジトリは外す", () => {
    const body = "できました：https://github.com/demo/landing-page/issues/7 と https://github.com/demo/morning-card.";
    expect(findNewRepo([report(body)], 7, own)).toEqual({
      name: "demo/morning-card",
      url: "https://github.com/demo/morning-card",
    });
  });

  it("相談のコメントと、人のコメントは見ない。無ければ null", () => {
    const talk = { ...report("https://github.com/demo/x"), body: `https://github.com/demo/x\n${encodeFactoryMark({ stage: "ideas" })}` };
    const human: CommentData = { ...report("https://github.com/demo/y"), author: OWNER };
    expect(findNewRepo([talk, human], 7, own)).toBeNull();
  });

  it("進捗図に新しいリポジトリを持たせる", () => {
    const p = factoryProgress({ ...base, comments: [report("https://github.com/demo/morning-card")], runs: [] });
    expect(p.repo?.url).toBe("https://github.com/demo/morning-card");
  });
});
