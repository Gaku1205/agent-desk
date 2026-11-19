import { describe, expect, it } from "vitest";
import type { IssueData, PullData, RepoResult } from "../github/types";
import { formatSpan } from "./duration";
import { buildBundle, buildLocalBundles } from "./bundle";
import { EXTENDED_DAYS, formatPeriodLabel, needsExtendedData, periodRange, periodWord } from "./period";
import { median, p90, parseRunRows, summarize, summarizeAll, summarySentence } from "./summary";

const NOW = new Date("2026-11-18T02:00:00Z"); // 日本時間 11/18 11:00
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

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

function pull(number: number, issueNumber: number, mergedAgo: number | null): PullData {
  return {
    number,
    title: `pr ${number}`,
    body: `Closes #${issueNumber}`,
    state: mergedAgo === null ? "open" : "closed",
    merged: mergedAgo !== null,
    labels: [],
    url: "",
    headRef: `claude/issue-${issueNumber}-x`,
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: ago(HOUR),
    updatedAt: ago(HOUR),
    mergedAt: mergedAgo === null ? null : ago(mergedAgo),
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

describe("formatSpan", () => {
  it("d・h・m・s で短く書く", () => {
    expect(formatSpan(20 * 1000)).toBe("20s");
    expect(formatSpan(38 * MIN + 59 * 1000)).toBe("38m");
    expect(formatSpan(HOUR + 52 * MIN)).toBe("1h 52m");
    expect(formatSpan(9 * HOUR + 41 * MIN)).toBe("9h 41m");
    expect(formatSpan(26 * HOUR)).toBe("1d 2h");
  });
  it("ちょうどの端は出さない", () => {
    expect(formatSpan(2 * HOUR)).toBe("2h");
    expect(formatSpan(24 * HOUR)).toBe("1d");
    expect(formatSpan(0)).toBe("0s");
  });
  it("負・数でないときは —", () => {
    expect(formatSpan(-1)).toBe("—");
    expect(formatSpan(Number.NaN)).toBe("—");
  });
});

describe("期間", () => {
  it("今からさかのぼった範囲と、前の期間の始め", () => {
    const range = periodRange(NOW, "24h");
    expect(range.end).toBe(NOW.getTime());
    expect(range.start).toBe(NOW.getTime() - 24 * HOUR);
    expect(range.prevStart).toBe(NOW.getTime() - 48 * HOUR);
    expect(periodRange(NOW, "7d").prevStart).toBe(NOW.getTime() - 14 * 24 * HOUR);
  });
  it("見出しの下の期間は日本時間", () => {
    expect(formatPeriodLabel(NOW, "24h", 12)).toBe("11/17 11:00 〜 11/18 11:00 · 12リポジトリ");
    expect(formatPeriodLabel(NOW, "7d", 3)).toBe("11/11 11:00 〜 11/18 11:00 · 3リポジトリ");
    expect(formatPeriodLabel(NOW, "30d", 12)).toBe("10/19 11:00 〜 11/18 11:00 · 12リポジトリ");
  });
  it("30d は30日と、その前の30日（合わせて60日）", () => {
    const range = periodRange(NOW, "30d");
    expect(range.start).toBe(NOW.getTime() - 30 * 24 * HOUR);
    expect(range.prevStart).toBe(NOW.getTime() - EXTENDED_DAYS * 24 * HOUR);
    expect(periodWord("30d")).toBe("30日");
    expect(needsExtendedData("30d")).toBe(true);
    expect(needsExtendedData("24h")).toBe(false);
    expect(needsExtendedData("7d")).toBe(false);
  });
});

describe("30d のまとめ", () => {
  it("30日と前の30日にマージを振り分ける（境目は始め以上・終わり未満）", () => {
    const day = 24 * HOUR;
    const data = {
      issues: [issue(1, 40 * day), issue(2, 10 * day)],
      pulls: [
        pull(11, 1, 10 * day), // 30日の中（Issue 作成から30日）
        pull(12, 2, 30 * day), // ちょうど始め → 30日の中
        pull(13, 3, 30 * day + 1), // 前の30日の中
        pull(14, 4, 60 * day - 1), // 前の30日の中
        pull(15, 5, 60 * day), // ちょうど前の始め → 前の30日の中
        pull(16, 6, 60 * day + 1), // 範囲の外
      ],
    };
    const summary = summarize([result(data)], NOW, "30d");
    expect(summary.merged).toBe(2);
    expect(summary.mergedPrev).toBe(3);
    expect(summarySentence(summary, periodWord("30d"))).toBe("この30日：2件マージ、止まり 0回");
  });
  it("配布のPR（pipeline-sync/）は merged・mergedPrev に入れず、期間内の外した数だけ数える", () => {
    const day = 24 * HOUR;
    const sync = (number: number, mergedAgo: number): PullData => ({
      ...pull(number, number, mergedAgo),
      body: "",
      headRef: `pipeline-sync/${number}`,
    });
    const data = {
      pulls: [pull(11, 1, 10 * day), pull(12, 2, 45 * day), sync(21, 5 * day), sync(22, 6 * day), sync(23, 40 * day), sync(24, 70 * day)],
    };
    const summary = summarize([result(data)], NOW, "30d");
    expect(summary.merged).toBe(1);
    expect(summary.mergedPrev).toBe(1);
    expect(summary.mergedSyncExcluded).toBe(2);
    expect(summarize([result({ pulls: [pull(11, 1, 10 * day)] })], NOW, "30d").mergedSyncExcluded).toBe(0);
    expect(summarize([result(data)], NOW, "24h").mergedSyncExcluded).toBe(0);
  });
  it("読めたリポジトリが無ければ数字は null（—）", () => {
    const failed: RepoResult = { owner: "o", repo: "r", ok: false, error: { kind: "other", message: "x" } };
    const summary = summarize([failed], NOW, "30d");
    expect(summary.merged).toBeNull();
    expect(summary.mergedPrev).toBeNull();
    expect(summary.mergedSyncExcluded).toBeNull();
  });
  it("buildLocalBundles は 24h・7d だけ（30d は専用の取得）", () => {
    expect(Object.keys(buildLocalBundles([], NOW))).toEqual(["24h", "7d"]);
    expect(buildBundle([], NOW, "30d").summary.merged).toBeNull();
  });
});

describe("median / p90", () => {
  it("空は null", () => {
    expect(median([])).toBeNull();
    expect(p90([])).toBeNull();
  });
  it("奇数・偶数", () => {
    expect(median([1, 5, 9])).toBe(5);
    expect(median([1, 5, 9, 11])).toBe(7);
  });
  it("p90 は ceil(0.9n) 番目", () => {
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90([4])).toBe(4);
  });
});

describe("summarize", () => {
  it("期間内と前の期間のマージ数、期間の境目", () => {
    const data = result({
      issues: [1, 2, 3, 4, 5].map((n) => issue(n, 100 * HOUR)),
      pulls: [
        pull(11, 1, 1 * HOUR), // 24h 内
        pull(12, 2, 24 * HOUR - 1), // 境目の内側
        pull(13, 3, 24 * HOUR), // ちょうど始め＝期間の内側（始めは含む）
        pull(14, 4, 40 * HOUR), // 前の期間
        pull(15, 5, null), // マージされていない
      ],
    });
    const s = summarize([data], NOW, "24h");
    expect(s.merged).toBe(3);
    expect(s.mergedPrev).toBe(1);
    expect(summarize([data], NOW, "7d").merged).toBe(4);
  });

  it("リードタイムは Issue の作成 → PR のマージ。紐づく Issue が無い PR は数えない", () => {
    const data = result({
      issues: [issue(1, 5 * HOUR), issue(2, 3 * HOUR)],
      pulls: [pull(11, 1, 1 * HOUR), pull(12, 2, 1 * HOUR), pull(13, 99, 1 * HOUR)],
    });
    const s = summarize([data], NOW, "24h");
    expect(s.merged).toBe(3);
    expect(s.leadMedianMs).toBe(3 * HOUR); // 4h と 2h の平均
    expect(s.leadP90Ms).toBe(4 * HOUR);
  });

  it("止まった回数は期間内に ai:stuck が付いた回数", () => {
    const data = result({
      events: [
        { event: "labeled", labelName: "ai:stuck", issueNumber: 1, createdAt: ago(2 * HOUR) },
        { event: "labeled", labelName: "ai:stuck", issueNumber: 2, createdAt: ago(30 * HOUR) },
        { event: "unlabeled", labelName: "ai:stuck", issueNumber: 1, createdAt: ago(1 * HOUR) },
        { event: "labeled", labelName: "ai:review", issueNumber: 1, createdAt: ago(1 * HOUR) },
      ],
    });
    expect(summarize([data], NOW, "24h").stopped).toBe(1);
    expect(summarize([data], NOW, "7d").stopped).toBe(2);
  });

  it("AI time は進捗ログの各行の所要時間の合計、runs は行数。進行中は今まで", () => {
    const line = (started: string, finished: string | null) =>
      `<!-- ai-step ${JSON.stringify({ step: "implement", model: "sonnet", started, finished, result: finished ? "success" : "running" })} -->`;
    const body = ["<!-- ai-step-log -->", line(ago(3 * HOUR), ago(2 * HOUR)), line(ago(30 * MIN), null), "<!-- ai-step {壊れ} -->"].join(
      "\n",
    );
    const data = result({
      comments: [{ id: 1, issueNumber: 1, author: "bot", body, createdAt: ago(MIN) }],
    });
    const s = summarize([data], NOW, "24h");
    expect(s.runs).toBe(2);
    expect(s.aiTimeMs).toBe(HOUR + 30 * MIN);
    expect(parseRunRows(body, NOW)).toHaveLength(2);
  });

  it("分からない数は null（—）。読めたリポジトリが無いときは全部 null", () => {
    const s = summarize([result({})], NOW, "24h");
    expect(s.fixedByHuman).toBeNull();
    expect(s.limitHits).toBeNull();
    expect(s.leadMedianMs).toBeNull();
    const failed: RepoResult = { owner: "o", repo: "r", ok: false, error: { kind: "other", message: "x" } };
    const none = summarize([failed], NOW, "24h");
    expect(none.merged).toBeNull();
    expect(none.stopped).toBeNull();
    expect(none.aiTimeMs).toBeNull();
  });

  it("両方の期間をまとめて作る", () => {
    const all = summarizeAll([result({})], NOW);
    expect(Object.keys(all)).toEqual(["24h", "7d", "30d"]);
  });
});

describe("summarySentence", () => {
  it("期間の言い方で文が替わる", () => {
    const s = summarize([result({})], NOW, "24h");
    expect(summarySentence({ ...s, merged: 14, stopped: 3 }, "24時間")).toBe(
      "この24時間：14件マージ、止まり 3回",
    );
    expect(summarySentence({ ...s, merged: 2, stopped: 0 }, "7日")).toBe(
      "この7日：2件マージ、止まり 0回",
    );
  });
});
