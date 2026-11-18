import { describe, expect, it } from "vitest";
import type { CommentData, IssueEventData, PullData, RepoResult } from "../github/types";
import { classifyStop, reasonRatios, stops } from "./stops";

const NOW = new Date("2026-11-18T02:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function event(kind: "labeled" | "unlabeled", number: number, agoMs: number, label = "ai:stuck"): IssueEventData {
  return { event: kind, labelName: label, issueNumber: number, createdAt: ago(agoMs) };
}

function comment(issueNumber: number, body: string, agoMs: number): CommentData {
  return { id: Math.floor(Math.random() * 1e9), issueNumber, author: "bot", body, createdAt: ago(agoMs) };
}

function pull(number: number, issueNumber: number, mergedAgo: number | null): PullData {
  return {
    number,
    title: "pr",
    body: `Closes #${issueNumber}`,
    state: mergedAgo === null ? "open" : "closed",
    merged: mergedAgo !== null,
    labels: [],
    url: "",
    headRef: `claude/issue-${issueNumber}-x`,
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: ago(10 * HOUR),
    updatedAt: ago(10 * HOUR),
    mergedAt: mergedAgo === null ? null : ago(mergedAgo),
  };
}

function result(data: Partial<Extract<RepoResult, { ok: true }>["data"]>, repo = "r"): RepoResult {
  return {
    owner: "o",
    repo,
    ok: true,
    data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...data },
  };
}

const failed: RepoResult = { owner: "o", repo: "x", ok: false, error: { kind: "other", message: "x" } };

describe("classifyStop", () => {
  it("言葉で CI・許可・順番待ち・人間の確認待ちに分ける", () => {
    expect(classifyStop("AIが3回直してもCIが通りませんでした（test）")).toBe("ci");
    expect(classifyStop("テストが落ちました")).toBe("ci");
    expect(classifyStop("ファイルを書く権限がありません")).toBe("permission");
    expect(classifyStop("permission denied")).toBe("permission");
    expect(classifyStop("順番待ちが長すぎました")).toBe("queue");
    expect(classifyStop("画面案を選んでください")).toBe("human");
  });
  it("理由が取れなければ人間の確認待ち。ci は単語の一部に当てない", () => {
    expect(classifyStop(null)).toBe("human");
    expect(classifyStop("specific な指示が必要です")).toBe("human");
  });
});

describe("stops", () => {
  it("読めたリポジトリが無ければ数は null、最近止まった物は空", () => {
    const value = stops([failed], NOW, "24h");
    expect(value.counts).toBeNull();
    expect(value.ciFailures).toBeNull();
    expect(value.recent).toEqual([]);
  });

  it("期間の境目：24h の外は数えない（7d には入る）", () => {
    const data = {
      events: [event("labeled", 1, 23 * HOUR), event("labeled", 2, 25 * HOUR)],
    };
    expect(stops([result(data)], NOW, "24h").recent.map((item) => item.number)).toEqual([1]);
    expect(stops([result(data)], NOW, "7d").recent.map((item) => item.number)).toEqual([1, 2]);
  });

  it("理由を分類して数え、PRの理由の文を使う", () => {
    const data = {
      pulls: [pull(10, 1, null)],
      comments: [comment(10, "⏸ 自動で進めるのを止めました：CIが通りませんでした", 3 * HOUR)],
      events: [event("labeled", 10, 3 * HOUR), event("labeled", 2, 2 * HOUR)],
    };
    const value = stops([result(data)], NOW, "24h");
    expect(value.counts).toEqual({ ci: 1, permission: 0, queue: 0, human: 1 });
    expect(value.recent[0]).toMatchObject({ repo: "r", number: 2, kind: "human", reason: null });
    expect(value.recent[1]).toMatchObject({ number: 10, kind: "ci", reason: "CIが通りませんでした" });
  });

  it("止まっていた時間：外れていれば Fixed、付いたままなら ongoing（今まで）", () => {
    const data = {
      events: [
        event("labeled", 1, 5 * HOUR),
        event("unlabeled", 1, 4 * HOUR),
        event("labeled", 2, 25 * MIN),
      ],
    };
    const [ongoing, fixed] = stops([result(data)], NOW, "24h").recent;
    expect(ongoing).toMatchObject({ number: 2, ongoing: true, fixed: false, durationMs: 25 * MIN });
    expect(fixed).toMatchObject({ number: 1, ongoing: false, fixed: true, durationMs: HOUR });
  });

  it("最近止まった物は新しい順に最大8件（回数は全部数える）", () => {
    const events = Array.from({ length: 10 }, (_, i) => event("labeled", i + 1, (i + 1) * HOUR));
    const value = stops([result({ events })], NOW, "24h");
    expect(value.recent).toHaveLength(8);
    expect(value.recent[0].number).toBe(1);
    expect(value.counts?.human).toBe(10);
  });

  it("CIの失敗＝CIの止まり＋修正依頼、うち自動で直った＝依頼のあとにマージされた物。やり直しの数", () => {
    const fix = "<!-- auto-fix -->\n@claude 直して（自動の依頼 1/3）";
    const data = {
      pulls: [pull(10, 1, 2 * HOUR), pull(11, 2, null)],
      comments: [
        comment(10, fix, 5 * HOUR),
        comment(11, fix, 4 * HOUR),
        comment(10, fix, 30 * HOUR),
        comment(3, "🔁 やり直します（やり直し 2/10回）\n理由：上限\n\n<!-- auto-retry -->", HOUR),
        comment(3, "<!-- auto-retry --> 読めない記録", HOUR),
      ],
      events: [],
    };
    const value = stops([result(data)], NOW, "24h");
    expect(value.ciFailures).toBe(2);
    expect(value.autoFixed).toBe(1);
    expect(value.retries).toBe(1);
  });

  it("リポジトリ名は owner/ を省いた名前、読めなかったリポジトリは数えない", () => {
    const value = stops([result({ events: [event("labeled", 5, HOUR)] }, "todo-app"), failed], NOW, "24h");
    expect(value.recent[0].repo).toBe("todo-app");
  });
});

describe("reasonRatios", () => {
  it("いちばん多い理由を1とした割合。全部0なら全部0", () => {
    expect(reasonRatios({ ci: 4, permission: 1, queue: 0, human: 2 })).toEqual({ ci: 1, permission: 0.25, queue: 0, human: 0.5 });
    expect(reasonRatios({ ci: 0, permission: 0, queue: 0, human: 0 }).ci).toBe(0);
  });
});
