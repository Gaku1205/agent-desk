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
    // pipeline.yml・watchdog.yml の実行と、ランプ用の実行（実行中・待機中・最近の物）の5つ
    await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(restCalls(calls)).toHaveLength(5);
    const [second] = await fetchAllRepos(TOKEN, repos, {
      fetcher,
      now: new Date(NOW.getTime() + ACTIONS_REFRESH_MS - 1),
    });
    expect(restCalls(calls)).toHaveLength(5);
    if (!second.ok) throw new Error("取れるはず");
    expect(second.data.pipeline).toBe("running");
    expect(second.data.watchdog).toEqual({ at: "2026-10-24T00:00:00Z" });
    expect(second.data.runs).toEqual([]);
    await fetchAllRepos(TOKEN, repos, { fetcher, now: new Date(NOW.getTime() + ACTIONS_REFRESH_MS) });
    expect(restCalls(calls)).toHaveLength(10);
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

describe("人間待ちの Issue は直近14日で絞らない", () => {
  const FIFTEEN_DAYS_AGO = "2026-10-10T00:00:00Z";
  const stuck = { labels: { nodes: [{ name: "ai:stuck" }] }, updatedAt: FIFTEEN_DAYS_AGO };

  async function fetchNumbers(issues: FakeRepo["issues"]): Promise<number[]> {
    const { fetcher } = fakeGitHub({ "o/r": { issues } });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    if (!result.ok) throw new Error("取れるはず");
    return result.data.issues.map((issue) => issue.number).sort((a, b) => a - b);
  }

  it("15日前に更新された、開いている ai:stuck の Issue は取る", async () => {
    expect(await fetchNumbers([gqlIssue(1, stuck)])).toEqual([1]);
  });

  it("4つのラベルのどれでも取る", async () => {
    const labelled = ["ai:skip", "ai:question", "factory:wait"].map((name, i) =>
      gqlIssue(i + 1, { labels: { nodes: [{ name }] }, updatedAt: FIFTEEN_DAYS_AGO }),
    );
    expect(await fetchNumbers(labelled)).toEqual([1, 2, 3]);
  });

  it("15日前の閉じた Issue・ラベルの無い Issue は今までどおり取らない", async () => {
    expect(
      await fetchNumbers([
        gqlIssue(1, { ...stuck, state: "CLOSED", closedAt: FIFTEEN_DAYS_AGO }),
        gqlIssue(2, { updatedAt: FIFTEEN_DAYS_AGO }),
      ]),
    ).toEqual([]);
  });

  it("同じ Issue が直近14日の一覧と人間待ちの一覧の両方に入っても1件", async () => {
    expect(await fetchNumbers([gqlIssue(1, { labels: { nodes: [{ name: "ai:stuck" }] } })])).toEqual([1]);
  });

  it("呼び出しは増えない（人間待ちの一覧は1回目だけ。続きの問い合わせには入れない）", async () => {
    const many = Array.from({ length: 150 }, (_, i) => gqlIssue(i + 1));
    const { fetcher, calls } = fakeGitHub({ "o/r": { issues: [...many, gqlIssue(500, stuck)] } });
    await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    const gql = graphqlCalls(calls);
    expect(gql).toHaveLength(2);
    expect(gql[0].variables).toMatchObject({ withMain: true });
    expect(gql[1].variables).toMatchObject({ withMain: false });
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
