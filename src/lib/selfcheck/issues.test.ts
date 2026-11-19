import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPreviousDriftsForTest,
  decideIssues,
  driftIssueTitle,
  formatFixedComment,
} from "./issues";
import { publishDriftIssues } from "./publish";
import type { SelfcheckReport } from "./run";
import type { Drift, RuleName } from "./types";

function drift(rule: RuleName, number = 1): Drift {
  return { repo: "o/r", number, rule, shown: "画面", actual: "実際" };
}

function report(drifts: Drift[]): SelfcheckReport {
  return { checkedAt: "2026-11-19T00:00:00.000Z", repoCount: 1, unreadable: [], drifts };
}

describe("decideIssues", () => {
  it("前回も今回も出ている決まりだけ raise、前回だけの決まりは fixed", () => {
    const result = decideIssues(
      [drift("slots-count"), drift("ai-working")],
      [drift("slots-count", 2), drift("your-turn-count")],
    );
    expect(result.raise).toEqual(["slots-count"]);
    expect(result.fixed).toEqual(["ai-working"]);
  });

  it("同じ決まりが複数件あっても決まり単位で1つ", () => {
    const result = decideIssues([drift("slots-count", 1), drift("slots-count", 2)], [drift("slots-count", 3)]);
    expect(result.raise).toEqual(["slots-count"]);
  });

  it("今回だけの決まりは何もしない", () => {
    expect(decideIssues([], [drift("all-sections")])).toEqual({ raise: [], fixed: [] });
  });
});

describe("題名とコメント", () => {
  it("題名は全角コロン", () => {
    expect(driftIssueTitle("slots-count")).toBe("表示のずれ：Slots の数");
  });
  it("直りました（日本時間）", () => {
    expect(formatFixedComment("2026-11-19T00:05:00.000Z")).toBe("直りました（2026-11-19 09:05 日本時間）");
  });
});

type Call = { url: string; method: string };

function makeFetcher(existing: { number: number; title: string }[], writeStatus = 201) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (method === "GET") return new Response(JSON.stringify(existing), { status: 200 });
    return new Response("{}", { status: writeStatus });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const settings = { owner: "o", repo: "desk" };
const writes = (calls: Call[]) => calls.filter((call) => call.method === "POST");

describe("publishDriftIssues", () => {
  beforeEach(() => clearPreviousDriftsForTest());

  it("1回目は立てない・2回目で Issue を1つ立て・3回目はコメント", async () => {
    const title = driftIssueTitle("slots-count");
    const first = makeFetcher([]);
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), first.fetcher);
    expect(first.calls).toHaveLength(0);

    const second = makeFetcher([]);
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), second.fetcher);
    expect(writes(second.calls).map((call) => call.url)).toEqual(["https://api.github.com/repos/o/desk/issues"]);

    const third = makeFetcher([{ number: 9, title }]);
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), third.fetcher);
    expect(writes(third.calls).map((call) => call.url)).toEqual(["https://api.github.com/repos/o/desk/issues/9/comments"]);
  });

  it("直ったら「直りました」を1回だけ書く", async () => {
    const title = driftIssueTitle("slots-count");
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), makeFetcher([]).fetcher);
    const fixed = makeFetcher([{ number: 9, title }]);
    await publishDriftIssues("t", settings, "s", report([]), fixed.fetcher);
    expect(writes(fixed.calls)).toHaveLength(1);
    const again = makeFetcher([{ number: 9, title }]);
    await publishDriftIssues("t", settings, "s", report([]), again.fetcher);
    expect(again.calls).toHaveLength(0);
  });

  it("書き込みが 403 でも落ちない", async () => {
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), makeFetcher([]).fetcher);
    const denied = makeFetcher([], 403);
    await expect(
      publishDriftIssues("t", settings, "s", report([drift("slots-count")]), denied.fetcher),
    ).resolves.toBeUndefined();
  });

  it("一覧が読めなかった（GET が 500）ときは Issue を立てない", async () => {
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), makeFetcher([]).fetcher);
    const calls: Call[] = [];
    const failing = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    await publishDriftIssues("t", settings, "s", report([drift("slots-count")]), failing);
    expect(writes(calls)).toHaveLength(0);
  });

  it("SETTINGS_REPO が無ければ何もしない", async () => {
    const none = makeFetcher([]);
    await publishDriftIssues("t", null, "s", report([drift("slots-count")]), none.fetcher);
    await publishDriftIssues("t", null, "s", report([drift("slots-count")]), none.fetcher);
    expect(none.calls).toHaveLength(0);
  });
});
