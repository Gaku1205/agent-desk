import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest } from "./client";
import { fakeGitHub, gqlIssue, gqlPull, type FakeCall, type FakeRepo } from "./fakeGitHub";
import { actionsCacheForTest, ACTIONS_REFRESH_MS, fetchAllRepos, mainDeployedCacheForTest } from "./fetch";
import type { GqlPull } from "./graphql";

const TOKEN = "ghp_count_test_token";
const NOW = new Date("2026-10-25T00:00:00Z");
const OLD = "2026-09-01T00:00:00Z";

const graphqlCalls = (calls: FakeCall[]) => calls.filter((c) => c.url.endsWith("/graphql"));
const restCalls = (calls: FakeCall[]) => calls.filter((c) => !c.url.endsWith("/graphql"));
const restOutsideActions = (calls: FakeCall[]) =>
  restCalls(calls).filter((c) => !new URL(c.url).pathname.includes("/actions/"));

/** PR 100件（開いている5件・マージ済み・閉じた物・Issueに紐づかない物）と Issue 30件のリポジトリ */
function busyRepo(): FakeRepo {
  const pulls: GqlPull[] = [];
  for (let n = 1; n <= 100; n++) {
    if (n <= 5) pulls.push(gqlPull(n));
    else if (n <= 9) pulls.push(gqlPull(n, { merged: true, statuses: [{ context: "Vercel", state: "SUCCESS", createdAt: "2026-10-24T00:00:00Z" }] }));
    else if (n <= 60) pulls.push(gqlPull(n, { state: "CLOSED" }));
    else pulls.push(gqlPull(n, { merged: true, headRefName: `pipeline-sync/${n}` }));
  }
  return { pulls, issues: Array.from({ length: 30 }, (_, i) => gqlIssue(i + 1)) };
}

beforeEach(() => {
  etagCacheForTest.clear();
  mainDeployedCacheForTest.clear();
  actionsCacheForTest.clear();
});

describe("1回の同期で呼ぶAPIの数", () => {
  it("3リポジトリ・PR 100件で、GraphQL 6回以内＋REST 0回（5分ごとの Actions の runs を除く）", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/a": busyRepo(), "o/b": busyRepo(), "o/c": busyRepo() });
    const repos = ["a", "b", "c"].map((repo) => ({ owner: "o", repo }));
    const results = await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(graphqlCalls(calls).length).toBeLessThanOrEqual(6);
    expect(restOutsideActions(calls)).toEqual([]);
  });

  it("1リポジトリは GraphQL 1回で済む", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": busyRepo() });
    await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    expect(graphqlCalls(calls)).toHaveLength(1);
    expect(graphqlCalls(calls)[0].variables).toMatchObject({ withIssues: true, withPulls: true, withMain: true });
  });

  it("Actions の runs は5分に1回だけ呼び、間は前の値を使う", async () => {
    const { fetcher, calls } = fakeGitHub({ "o/r": busyRepo() });
    const repos = [{ owner: "o", repo: "r" }];
    await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(restCalls(calls)).toHaveLength(2);
    const [second] = await fetchAllRepos(TOKEN, repos, {
      fetcher,
      now: new Date(NOW.getTime() + ACTIONS_REFRESH_MS - 1),
    });
    expect(restCalls(calls)).toHaveLength(2);
    if (!second.ok) throw new Error("取れるはず");
    expect(second.data.pipeline).toBe("running");
    expect(second.data.watchdog).toEqual({ at: "2026-10-24T00:00:00Z" });
    await fetchAllRepos(TOKEN, repos, { fetcher, now: new Date(NOW.getTime() + ACTIONS_REFRESH_MS) });
    expect(restCalls(calls)).toHaveLength(4);
  });
});

describe("ページ送り", () => {
  it("Issue が100件を超えると、続きの Issue だけをもう1回問い合わせる（main は入れない）", async () => {
    const issues = Array.from({ length: 150 }, (_, i) => gqlIssue(i + 1));
    const { fetcher, calls } = fakeGitHub({ "o/r": { issues, pulls: [gqlPull(1)] } });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    const gql = graphqlCalls(calls);
    expect(gql).toHaveLength(2);
    expect(gql[1].variables).toMatchObject({ withIssues: true, withPulls: false, withMain: false, issuesAfter: "100" });
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.issues).toHaveLength(150);
    expect(result.data.pulls).toHaveLength(1);
  });

  it("PR のページのいちばん古い物が直近14日より前なら、続きは取らない", async () => {
    const pulls = Array.from({ length: 150 }, (_, i) =>
      gqlPull(i + 1, i < 99 ? {} : { updatedAt: OLD, createdAt: OLD }),
    );
    const { fetcher, calls } = fakeGitHub({ "o/r": { pulls } });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    expect(graphqlCalls(calls)).toHaveLength(1);
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pulls).toHaveLength(99);
  });

  it("PR が直近14日に100件を超えると、続きの PR だけをもう1回問い合わせる", async () => {
    const pulls = Array.from({ length: 130 }, (_, i) => gqlPull(i + 1));
    const { fetcher, calls } = fakeGitHub({ "o/r": { pulls } });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    const gql = graphqlCalls(calls);
    expect(gql).toHaveLength(2);
    expect(gql[1].variables).toMatchObject({ withIssues: false, withPulls: true, pullsAfter: "100" });
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pulls).toHaveLength(130);
  });
});

describe("チェックを持たせるPR（取る量を減らした時の決まりを引き継ぐ）", () => {
  it("閉じた（未マージ）PRとIssueに紐づかないPRは持たない。マージ済みは公開ステータスだけ", async () => {
    const { fetcher } = fakeGitHub({
      "o/r": {
        pulls: [
          gqlPull(1),
          gqlPull(2, { headRefName: "feature/y", body: "Closes #2" }),
          gqlPull(3, { state: "CLOSED" }),
          gqlPull(4, { headRefName: "pipeline-sync/1" }),
          gqlPull(7, { merged: true, statuses: [{ context: "Vercel", state: "SUCCESS", createdAt: "2026-10-24T00:05:00Z" }] }),
        ],
      },
    });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    if (!result.ok) throw new Error("取れるはず");
    expect(Object.keys(result.data.pullChecks).sort()).toEqual(["1", "2", "7"]);
    expect(result.data.pullChecks[7].checkRuns).toEqual([]);
    expect(result.data.pullChecks[7].statuses[0]?.context).toBe("Vercel");
  });
});
