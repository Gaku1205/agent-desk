import { describe, expect, it } from "vitest";
import type { CommentData, IssueEventData, PullData, RepoResult } from "../github/types";
import { summarize } from "./summary";
import { longestStep, maxP90, throughput, throughputAll } from "./throughput";

const NOW = new Date("2026-11-18T02:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function line(step: string, startedAgo: number, durationMs: number | null): string {
  const json = JSON.stringify({
    step,
    model: "sonnet",
    started: ago(startedAgo),
    finished: durationMs === null ? null : ago(startedAgo - durationMs),
    result: "success",
  });
  return `<!-- ai-step ${json} -->`;
}

function log(lines: string[]): CommentData {
  return { id: 1, issueNumber: 1, author: "bot", body: `<!-- ai-step-log -->\n| 表 |\n${lines.join("\n")}`, createdAt: ago(HOUR) };
}

function pull(number: number, mergedAgo: number): PullData {
  return {
    number,
    title: `pr ${number}`,
    body: "",
    state: "closed",
    merged: true,
    labels: [],
    url: "",
    headRef: `claude/issue-${number}-x`,
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: ago(HOUR),
    updatedAt: ago(HOUR),
    mergedAt: ago(mergedAgo),
  };
}

function queueEvent(event: "labeled" | "unlabeled", issueNumber: number, at: number, labelName = "ai:queue"): IssueEventData {
  return { event, labelName, issueNumber, createdAt: ago(at) };
}

function result(repo: string, data: Partial<Extract<RepoResult, { ok: true }>["data"]>): RepoResult {
  return { owner: "o", repo, ok: true, data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...data } };
}

describe("リポジトリごとのマージ数", () => {
  it("期間の境目：始めは含み、終わり（今）は含まない", () => {
    const r = result("a", { pulls: [pull(1, 24 * HOUR), pull(2, 24 * HOUR + 1), pull(3, 0)] });
    expect(throughput([r], NOW, "24h").repos).toEqual([{ owner: "o", repo: "a", merged: 1 }]);
    expect(throughput([r], NOW, "7d").repos[0].merged).toBe(2);
  });

  it("配布のPR（pipeline-sync/）は数えない（Merged と同じ数え方）", () => {
    const sync = { ...pull(9, HOUR), headRef: "pipeline-sync/9" };
    const rs = [result("a", { pulls: [pull(1, HOUR), sync] }), result("b", { pulls: [{ ...sync, number: 10 }] })];
    const t = throughput(rs, NOW, "24h");
    expect(t.repos).toEqual([{ owner: "o", repo: "a", merged: 1 }]);
    expect(summarize(rs, NOW, "24h").merged).toBe(1);
  });

  it("多い順に並べ、同数は名前順。0件は入れない", () => {
    const rs = [
      result("c", { pulls: [pull(1, HOUR)] }),
      result("b", { pulls: [pull(1, HOUR), pull(2, HOUR)] }),
      result("a", { pulls: [pull(1, HOUR)] }),
      result("z", {}),
    ];
    expect(throughput(rs, NOW, "24h").repos.map((r) => `${r.repo}:${r.merged}`)).toEqual(["b:2", "a:1", "c:1"]);
  });

  it("5つに切る", () => {
    const rs = ["a", "b", "c", "d", "e", "f", "g"].map((name) => result(name, { pulls: [pull(1, HOUR)] }));
    expect(throughput(rs, NOW, "24h").repos.map((r) => r.repo)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("工程ごとの時間", () => {
  it("median・p90 を工程ごとに出す。mocks・deploy は出さない。期間外に始まった行は数えない", () => {
    const lines = [
      line("implement", 5 * HOUR, 10 * MIN),
      line("implement", 4 * HOUR, 20 * MIN),
      line("implement", 3 * HOUR, 30 * MIN),
      line("implement", 2 * HOUR, 40 * MIN),
      line("implement", 25 * HOUR, 99 * MIN),
      line("mocks", HOUR, 5 * MIN),
      line("deploy", HOUR, 5 * MIN),
      line("ci", HOUR, 3 * MIN),
    ];
    const t = throughput([result("a", { comments: [log(lines)] })], NOW, "24h");
    const implement = t.steps.find((s) => s.step === "implement");
    expect(implement).toEqual({ step: "implement", count: 4, medianMs: 25 * MIN, p90Ms: 40 * MIN });
    expect(t.steps.find((s) => s.step === "ci")?.count).toBe(1);
    expect(t.steps.map((s) => s.step)).toEqual(["plan", "implement", "ci", "review", "fix", "queue"]);
    expect(throughput([result("a", { comments: [log(lines)] })], NOW, "7d").steps[1].count).toBe(5);
  });
});

describe("Queue", () => {
  it("付いてから外れるまでを1件にする", () => {
    const events = [queueEvent("labeled", 5, 3 * HOUR), queueEvent("unlabeled", 5, 2 * HOUR)];
    const queue = throughput([result("a", { events })], NOW, "24h").steps[5];
    expect(queue).toEqual({ step: "queue", count: 1, medianMs: HOUR, p90Ms: HOUR });
  });

  it("まだ外れていなければ「今」まで", () => {
    const queue = throughput([result("a", { events: [queueEvent("labeled", 5, 90 * MIN)] })], NOW, "24h").steps[5];
    expect(queue.medianMs).toBe(90 * MIN);
  });

  it("期間内に付いた物だけ数える。ほかのラベル・付いていない外しは無視", () => {
    const events = [
      queueEvent("labeled", 1, 30 * HOUR),
      queueEvent("unlabeled", 1, 29 * HOUR),
      queueEvent("labeled", 2, HOUR, "ai:stuck"),
      queueEvent("unlabeled", 3, HOUR),
    ];
    expect(throughput([result("a", { events })], NOW, "24h").steps[5].count).toBe(0);
    expect(throughput([result("a", { events })], NOW, "7d").steps[5].count).toBe(1);
  });

  it("同じ Issue の付け直しは別の1件", () => {
    const events = [
      queueEvent("labeled", 5, 5 * HOUR),
      queueEvent("unlabeled", 5, 4 * HOUR),
      queueEvent("labeled", 5, 2 * HOUR),
    ];
    expect(throughput([result("a", { events })], NOW, "24h").steps[5].count).toBe(2);
  });
});

describe("longestStep・maxP90", () => {
  it("median が最大の工程。全部 null なら null", () => {
    const events = [queueEvent("labeled", 5, 3 * HOUR)];
    const t = throughput([result("a", { events, comments: [log([line("ci", HOUR, MIN)])] })], NOW, "24h");
    expect(t.longest).toBe("queue");
    expect(longestStep(t.steps)).toBe("queue");
    expect(maxP90(t.steps)).toBe(3 * HOUR);
  });

  it("データ無し：読めたリポジトリが無い・件数0", () => {
    const failed: RepoResult = { owner: "o", repo: "x", ok: false, error: { kind: "other", message: "x" } };
    const t = throughput([failed], NOW, "24h");
    expect(t.repos).toEqual([]);
    expect(t.longest).toBeNull();
    expect(maxP90(t.steps)).toBeNull();
    expect(t.steps.every((s) => s.count === 0 && s.medianMs === null)).toBe(true);
    expect(throughput([result("a", {})], NOW, "24h").longest).toBeNull();
  });

  it("全部の期間を作る", () => {
    expect(Object.keys(throughputAll([], NOW))).toEqual(["24h", "7d", "30d"]);
  });
});
