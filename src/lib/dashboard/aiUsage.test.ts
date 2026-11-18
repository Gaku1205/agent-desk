import { describe, expect, it } from "vitest";
import type { CommentData, IssueData, PullData, RepoResult } from "../github/types";
import { aiUsage, aiUsageAll, barRatios, usageModel } from "./aiUsage";

const NOW = new Date("2026-11-18T02:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function line(step: string, model: string | null, startedAgo: number, finishedAgo: number | null): string {
  const json = JSON.stringify({
    step,
    model,
    started: ago(startedAgo),
    finished: finishedAgo === null ? null : ago(finishedAgo),
    result: finishedAgo === null ? "running" : "success",
  });
  return `<!-- ai-step ${json} -->`;
}

function log(issueNumber: number, lines: string[]): CommentData {
  return {
    id: issueNumber,
    issueNumber,
    author: "bot",
    body: `<!-- ai-step-log -->\n| 表 |\n${lines.join("\n")}`,
    createdAt: ago(HOUR),
  };
}

function issue(number: number, createdAgo: number): IssueData {
  return {
    number,
    title: `issue ${number}`,
    body: "",
    state: "closed",
    labels: [],
    url: "",
    createdAt: ago(createdAgo),
    updatedAt: ago(createdAgo),
    closedAt: null,
  };
}

function pull(number: number, issueNumber: number, mergedAgo: number): PullData {
  return {
    number,
    title: `pr ${number}`,
    body: `Closes #${issueNumber}`,
    state: "closed",
    merged: true,
    labels: [],
    url: "",
    headRef: `claude/issue-${issueNumber}-x`,
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: ago(HOUR),
    updatedAt: ago(HOUR),
    mergedAt: ago(mergedAgo),
  };
}

function result(data: Partial<Extract<RepoResult, { ok: true }>["data"]>): RepoResult {
  return {
    owner: "o",
    repo: "r",
    ok: true,
    data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...data },
  };
}

const row = (usage: ReturnType<typeof aiUsage>, step: string) => usage.rows.find((r) => r.step === step)!;

describe("usageModel", () => {
  it("モデル名を列に当てる", () => {
    expect(usageModel("sonnet")).toBe("sonnet");
    expect(usageModel("claude-opus-5-5")).toBe("opus");
    expect(usageModel("fable")).toBe("fable");
    expect(usageModel("haiku")).toBeNull();
    expect(usageModel(null)).toBeNull();
  });
});

describe("aiUsage の表", () => {
  it("工程は進捗図の並びで、記録が無い工程も出る（回数 0・時間は null＝—）", () => {
    const usage = aiUsage([result({})], NOW, "24h");
    expect(usage.rows.map((r) => r.step)).toEqual(["plan", "design", "implement", "ci", "review", "fix", "deploy"]);
    expect(row(usage, "plan")).toEqual({ step: "plan", counts: { sonnet: 0, opus: 0, fable: 0 }, totalMs: null });
    expect(usage.limitHits).toBeNull();
  });

  it("回数は行数（同じ工程の行も数える）、Total は時間の合計。mocks は design の行", () => {
    const comments = [
      log(1, [line("plan", "opus", 3 * HOUR, 2 * HOUR), line("mocks", "sonnet", 2 * HOUR, 90 * MIN)]),
      log(2, [line("plan", "opus", 5 * HOUR, 4 * HOUR + 30 * MIN), line("implement", "fable", 3 * HOUR, 2 * HOUR)]),
    ];
    const usage = aiUsage([result({ comments })], NOW, "24h");
    expect(row(usage, "plan").counts).toEqual({ sonnet: 0, opus: 2, fable: 0 });
    expect(row(usage, "plan").totalMs).toBe(HOUR + 30 * MIN);
    expect(row(usage, "design").counts.sonnet).toBe(1);
    expect(row(usage, "design").totalMs).toBe(30 * MIN);
    expect(row(usage, "implement").counts.fable).toBe(1);
  });

  it("モデルが無い行・知らないモデルは、どの列にも数えず Total だけに入る", () => {
    const comments = [log(1, [line("ci", null, 2 * HOUR, 2 * HOUR - 45 * 1000), line("review", "haiku", HOUR, 50 * MIN)])];
    const usage = aiUsage([result({ comments })], NOW, "24h");
    expect(row(usage, "ci").counts).toEqual({ sonnet: 0, opus: 0, fable: 0 });
    expect(row(usage, "ci").totalMs).toBe(45 * 1000);
    expect(row(usage, "review").counts).toEqual({ sonnet: 0, opus: 0, fable: 0 });
    expect(row(usage, "review").totalMs).toBe(10 * MIN);
  });

  it("期間の境目：始まりが期間内の行だけ。24h の外でも 7d には入る", () => {
    const comments = [
      log(1, [line("plan", "opus", 25 * HOUR, 24 * HOUR + 30 * MIN)]),
      log(2, [line("fix", "sonnet", 24 * HOUR, 23 * HOUR)]), // ちょうど始まり＝含む
    ];
    const day = aiUsage([result({ comments })], NOW, "24h");
    expect(row(day, "plan").counts.opus).toBe(0);
    expect(row(day, "fix").counts.sonnet).toBe(1);
    const week = aiUsage([result({ comments })], NOW, "7d");
    expect(row(week, "plan").counts.opus).toBe(1);
  });

  it("進行中の行は「今」までの時間", () => {
    const usage = aiUsage([result({ comments: [log(1, [line("implement", "opus", 2 * HOUR, null)])] })], NOW, "24h");
    expect(row(usage, "implement").counts.opus).toBe(1);
    expect(row(usage, "implement").totalMs).toBe(2 * HOUR);
  });

  it("壊れた行・知らない工程・進捗ログでないコメントは読み飛ばす", () => {
    const broken: CommentData = {
      ...log(1, []),
      body: `<!-- ai-step-log -->\n<!-- ai-step {oops -->\n${line("unknown", "opus", HOUR, 0)}\n<!-- ai-step {"step":"plan","model":"opus","started":"x","finished":null} -->\n${line("plan", "opus", HOUR, 30 * MIN)}`,
    };
    const plain: CommentData = { ...log(2, []), body: line("plan", "opus", HOUR, 30 * MIN) };
    const usage = aiUsage([result({ comments: [broken, plain] })], NOW, "24h");
    expect(row(usage, "plan").counts.opus).toBe(1);
    expect(usage.rows.reduce((sum, r) => sum + (r.totalMs ?? 0), 0)).toBe(30 * MIN);
  });

  it("読めたリポジトリが無いときは Total が null（—）", () => {
    const failed: RepoResult = { owner: "o", repo: "r", ok: false, error: { kind: "other", message: "x" } };
    const usage = aiUsage([failed], NOW, "24h");
    expect(usage.rows.every((r) => r.totalMs === null)).toBe(true);
    expect(usage.parallelMs).toBeNull();
    expect(usage.serialMs).toBeNull();
  });
});

describe("Parallel 3 と Serial", () => {
  it("作業の幅が重なれば Parallel、重ならなければ Serial。値は作成 → マージの中央値", () => {
    const data = {
      issues: [issue(1, 10 * HOUR), issue(2, 9 * HOUR), issue(3, 4 * HOUR)],
      pulls: [pull(11, 1, 5 * HOUR), pull(12, 2, 4 * HOUR + 30 * MIN), pull(13, 3, 1 * HOUR)],
      comments: [
        log(1, [line("plan", "opus", 9 * HOUR, 8 * HOUR)]), // 幅 9h前〜5h前
        log(2, [line("plan", "opus", 8 * HOUR, 7 * HOUR)]), // 幅 8h前〜4.5h前（1と重なる）
        log(3, [line("plan", "opus", 3 * HOUR, 2 * HOUR)]), // 幅 3h前〜1h前（誰とも重ならない）
      ],
    };
    const usage = aiUsage([result(data)], NOW, "24h");
    expect(usage.parallelMs).toBe(4.75 * HOUR); // 1：5h、2：4.5h の中央値
    expect(usage.serialMs).toBe(3 * HOUR); // 3：4h前に作成 → 1h前にマージ
  });

  it("片方が無いときは null（—）で、棒の比も null", () => {
    const data = {
      issues: [issue(3, 4 * HOUR)],
      pulls: [pull(13, 3, 1 * HOUR)],
      comments: [log(3, [line("plan", "opus", 3 * HOUR, 2 * HOUR)])],
    };
    const usage = aiUsage([result(data)], NOW, "24h");
    expect(usage.serialMs).toBe(3 * HOUR);
    expect(usage.parallelMs).toBeNull();
    expect(barRatios(usage.parallelMs, usage.serialMs)).toEqual({ parallel: null, serial: 1 });
  });

  it("期間の外でマージされたPRは数えない。進捗ログが無いIssueは数えない", () => {
    const data = {
      issues: [issue(1, 40 * HOUR), issue(2, 5 * HOUR)],
      pulls: [pull(11, 1, 30 * HOUR), pull(12, 2, HOUR)],
      comments: [log(1, [line("plan", "opus", 39 * HOUR, 38 * HOUR)])],
    };
    const day = aiUsage([result(data)], NOW, "24h");
    expect(day.serialMs).toBeNull();
    expect(day.parallelMs).toBeNull();
    expect(aiUsage([result(data)], NOW, "7d").serialMs).toBe(10 * HOUR);
  });
});

describe("barRatios", () => {
  it("長い方を1として比にする", () => {
    expect(barRatios(2 * HOUR, 4 * HOUR)).toEqual({ parallel: 0.5, serial: 1 });
    expect(barRatios(null, null)).toEqual({ parallel: null, serial: null });
  });
});

describe("aiUsageAll", () => {
  it("24h・7d・30d を作る", () => {
    const all = aiUsageAll([result({})], NOW);
    expect(Object.keys(all)).toEqual(["24h", "7d", "30d"]);
  });
});
