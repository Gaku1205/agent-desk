import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest } from "./client";
import {
  EXTENDED_CACHE_MS,
  EXTENDED_MAX_PAGES,
  EXTENDED_PAGE_SIZE,
  EXTENDED_QUERY,
  extendedCacheForTest,
  extendedQueryCost,
  fetchExtendedRepos,
} from "./extended";
import { fakeGitHub, gqlIssue, gqlPull, type FakeRepo } from "./fakeGitHub";

const TOKEN = "ghp_extended_test_token";
const NOW = new Date("2026-11-18T02:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const repo = { owner: "o", repo: "r" };

beforeEach(() => {
  etagCacheForTest.clear();
  extendedCacheForTest.clear();
});

function repoWith(pulls: number, issues = 0): FakeRepo {
  return {
    pulls: Array.from({ length: pulls }, (_, i) => gqlPull(i + 1, { merged: true, updatedAt: ago(1), mergedAt: ago(1) })),
    issues: Array.from({ length: issues }, (_, i) => gqlIssue(i + 1, { updatedAt: ago(1), createdAt: ago(2) })),
  };
}

describe("30日分の取得（Dashboard の 30d）", () => {
  it("1ページ（50件）に収まるリポジトリは、GraphQL 1回・REST 0回", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": repoWith(30, 30) });
    const [result] = await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/graphql"))).toHaveLength(1);
    expect(calls.filter((c) => !c.url.endsWith("/graphql"))).toEqual([]);
    expect(calls[0].variables).toMatchObject({ withIssues: true, withPulls: true, since: ago(60) });
  });

  it("50件を超えると、続きのPRだけをもう1回問い合わせる", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": repoWith(75, 10) });
    const [result] = await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    expect(calls).toHaveLength(2);
    expect(calls[1].variables).toMatchObject({ withIssues: false, withPulls: true, pullsAfter: "50" });
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pulls).toHaveLength(75);
  });

  it("ページのいちばん古い物が60日前より前なら、続きは取らない", async () => {
    const pulls = Array.from({ length: 120 }, (_, i) =>
      gqlPull(i + 1, { merged: true, updatedAt: i < 49 ? ago(1) : ago(61), mergedAt: i < 49 ? ago(1) : ago(61) }),
    );
    const { fetcher, calls } = fakeGitHub({ "o/r": { pulls } });
    const [result] = await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    expect(calls).toHaveLength(1);
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pulls).toHaveLength(49);
  });

  it("PR・Issue それぞれ最大10ページ（500件）まで", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": repoWith(700, 700) });
    const [result] = await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    expect(calls).toHaveLength(EXTENDED_MAX_PAGES);
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pulls).toHaveLength(EXTENDED_MAX_PAGES * EXTENDED_PAGE_SIZE);
  });

  it("5分以内の2回目は GitHub を読まない。5分たつと取り直す", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": repoWith(10, 10) });
    await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: new Date(NOW.getTime() + EXTENDED_CACHE_MS - 1) });
    expect(calls).toHaveLength(1);
    await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: new Date(NOW.getTime() + EXTENDED_CACHE_MS) });
    expect(calls).toHaveLength(2);
  });

  it("覚えるキーはトークンごと（別のトークンには使い回さない）", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": repoWith(10, 10) });
    await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    await fetchExtendedRepos("ghp_other", [repo], { fetcher, now: NOW });
    expect(calls).toHaveLength(2);
  });

  it("1つのリポジトリが失敗しても、ほかは取れる（失敗は ok: false）", async () => {
    const { fetcher } = fakeGitHub({ "o/a": repoWith(3, 3) });
    const results = await fetchExtendedRepos(TOKEN, [{ owner: "o", repo: "a" }, { owner: "o", repo: "missing" }], { fetcher, now: NOW });
    expect(results.map((result) => result.ok)).toEqual([true, false]);
  });

  it("失敗は覚えない（次の表示で取り直す）", async () => {
    const { fetcher } = fakeGitHub({});
    await fetchExtendedRepos(TOKEN, [repo], { fetcher, now: NOW });
    expect(extendedCacheForTest.size()).toBe(0);
  });
});

describe("問い合わせの点数（GraphQL の回数制限）", () => {
  it("1ページ（Issue 50件＋PR 50件）で2点、片方だけなら1点", () => {
    expect(extendedQueryCost({ withIssues: true, withPulls: true })).toBe(2);
    expect(extendedQueryCost({ withIssues: true, withPulls: false })).toBe(1);
    expect(extendedQueryCost({ withIssues: false, withPulls: true })).toBe(1);
  });

  it("問い合わせの文に決めた件数が入り、チェック・ファイル・ラベル・題名は取らない", () => {
    expect(EXTENDED_QUERY.match(new RegExp(`first: ${EXTENDED_PAGE_SIZE}\\n`, "g"))).toHaveLength(2);
    expect(EXTENDED_QUERY).toContain("states: MERGED");
    for (const word of ["statusCheckRollup", "files(", "labels(", "title", "mergeCommit", "commits("]) {
      expect(EXTENDED_QUERY).not.toContain(word);
    }
  });
});
