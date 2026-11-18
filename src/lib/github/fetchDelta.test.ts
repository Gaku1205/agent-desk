import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest } from "./client";
import { FULL_READ_INTERVAL_MS } from "./delta";
import { fakeGitHub, gqlIssue, gqlPull, jsonResponse, type FakeCall, type FakeRepo } from "./fakeGitHub";
import { actionsCacheForTest, deltaBaseCacheForTest, fetchAllRepos, mainDeployedCacheForTest } from "./fetch";
import { deltaQueryCost, type GqlComment, type GqlIssue, type GqlPull } from "./graphql";
import type { RepoData, RepoResult } from "./types";

const TOKEN = "ghp_delta_test_token";
const REPOS = [{ owner: "o", repo: "r" }];
const T0 = Date.parse("2026-10-25T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(ms).toISOString();

const graphqlCalls = (calls: FakeCall[]) => calls.filter((c) => c.url.endsWith("/graphql"));

beforeEach(() => {
  etagCacheForTest.clear();
  mainDeployedCacheForTest.clear();
  actionsCacheForTest.clear();
  deltaBaseCacheForTest.clear();
});

function comments(number: number, createdMs: number, count = 3): { nodes: GqlComment[] } {
  return {
    nodes: Array.from({ length: count }, (_, i) => ({
      databaseId: number * 100 + i,
      body: `comment ${i} on ${number}`,
      createdAt: at(createdMs + i * MIN),
      updatedAt: at(createdMs + i * MIN),
      url: `https://github.com/o/r/issues/${number}#c${i}`,
      author: { __typename: "Bot", login: "claude" },
    })),
  };
}

/**
 * 14日分 270件（Issue 120件・PR 150件）のリポジトリ。更新はおよそ1時間ごとに散らばる（新しい順）。
 * 開いている Issue 12件・PR 6件、ほかは閉じた・マージ済み。人間待ちの Issue（14日より前）も1件
 */
function bigRepo(): { issues: GqlIssue[]; pulls: GqlPull[] } {
  const issues: GqlIssue[] = [];
  const pulls: GqlPull[] = [];
  for (let i = 0; i < 270; i++) {
    const updated = T0 - (i + 2) * 74 * MIN;
    const created = updated - 3 * HOUR;
    if (i % 9 < 4) {
      const n = 1000 + i;
      const open = issues.length < 12;
      issues.push(
        gqlIssue(n, {
          state: open ? "OPEN" : "CLOSED",
          closedAt: open ? null : at(updated),
          createdAt: at(created),
          updatedAt: at(updated),
          labels: { nodes: [{ name: open ? "ai:queue" : "ai:done" }] },
          comments: comments(n, created),
          timelineItems: { nodes: [{ __typename: "LabeledEvent", createdAt: at(created), label: { name: "ai:implement" } }] },
        }),
      );
    } else {
      const n = 2000 + i;
      const open = pulls.length < 6;
      pulls.push(
        gqlPull(n, {
          merged: !open,
          createdAt: at(created),
          updatedAt: at(updated),
          comments: comments(n, created, 2),
          statuses: [{ context: "Vercel", state: "SUCCESS", createdAt: at(updated) }],
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS", completedAt: at(updated) }],
                    },
                  },
                },
              },
            ],
          },
        }),
      );
    }
  }
  issues.push(
    gqlIssue(900, {
      updatedAt: at(T0 - 20 * 24 * HOUR),
      createdAt: at(T0 - 21 * 24 * HOUR),
      labels: { nodes: [{ name: "ai:stuck" }] },
      comments: comments(900, T0 - 21 * 24 * HOUR, 1),
    }),
  );
  return { issues, pulls };
}

/** 画面に出す中身（読み方の記録 `sync` を除く） */
function shown(result: RepoResult): RepoData {
  if (!result.ok) throw new Error("取れるはず");
  return { ...result.data, sync: undefined };
}

async function read(repo: FakeRepo, nowMs: number) {
  const { fetcher, calls } = fakeGitHub({ "o/r": repo });
  let bytes = 0;
  // GraphQL の返事の大きさ（GitHub が組み立てて送る量。時間はおよそこれに比例する）
  const measured: typeof fetch = async (input, init) => {
    const response = await fetcher(input, init);
    if (String(input).endsWith("/graphql")) bytes += (await response.clone().text()).length;
    return response;
  };
  const [result] = await fetchAllRepos(TOKEN, REPOS, { fetcher: measured, now: new Date(nowMs) });
  return { result, calls: graphqlCalls(calls), kb: Math.round(bytes / 1024) };
}

/** 変化3件：Issue にコメントが付いた・PR が新しくできた・開いていた PR がマージされた */
function changeThree(repo: { issues: GqlIssue[]; pulls: GqlPull[] }, nowMs: number): FakeRepo {
  const issues = repo.issues.map((issue, i) =>
    i === 20
      ? {
          ...issue,
          updatedAt: at(nowMs - MIN),
          comments: { nodes: [...(issue.comments?.nodes ?? []), ...comments(5555, nowMs - MIN, 1).nodes] },
        }
      : issue,
  );
  const merged = repo.pulls.map((pull, i) =>
    i === 2
      ? gqlPull(pull.number, {
          merged: true,
          createdAt: pull.createdAt,
          updatedAt: at(nowMs - 2 * MIN),
          mergedAt: at(nowMs - 2 * MIN),
        })
      : pull,
  );
  const added = gqlPull(3000, { createdAt: at(nowMs - 3 * MIN), updatedAt: at(nowMs - 3 * MIN) });
  return { issues, pulls: [added, ...merged] };
}

describe("差分の読み（docs/spec.md の「データの取得」の「差分だけ読む」）", () => {
  it("差分で混ぜた結果は、全部を読み直した結果と同じ（14日分 270件・変化3件）", async () => {
    const before = bigRepo();
    const first = await read(before, T0);
    expect(first.result.ok && first.result.data.sync?.mode).toBe("full");

    const t1 = T0 + 10 * MIN;
    const after = changeThree(before, t1);
    const delta = await read(after, t1);
    expect(delta.result.ok && delta.result.data.sync?.mode).toBe("delta");

    deltaBaseCacheForTest.clear();
    mainDeployedCacheForTest.clear();
    const full = await read(after, t1);
    expect(full.result.ok && full.result.data.sync?.mode).toBe("full");
    expect(shown(delta.result)).toEqual(shown(full.result));
  });

  it("GraphQL の回数・読む件数・時間が大きく減る（14日分 270件・変化3件。PRに書く前後の数）", async () => {
    const before = bigRepo();
    await read(before, T0);
    const t1 = T0 + 10 * MIN;
    const after = changeThree(before, t1);
    const delta = await read(after, t1);
    deltaBaseCacheForTest.clear();
    const full = await read(after, t1);
    const fullCount = full.result.ok ? (full.result.data.sync?.count ?? 0) : 0;
    const deltaCount = delta.result.ok ? (delta.result.data.sync?.count ?? 0) : 0;
    // 1回の時間の見積もり：往復 200ms ＋ 返した Issue・PR 1件ごとに 30ms（呼び出しは順に並ぶので足す）
    const fullMs = full.calls.length * 200 + fullCount * 30;
    const deltaMs = delta.calls.length * 200 + deltaCount * 30;
    console.info(
      `全部: GraphQL ${full.calls.length}回・${fullCount}件・${full.kb}KB・見積もり ${fullMs}ms / 差分: GraphQL ${delta.calls.length}回・${deltaCount}件・${delta.kb}KB・見積もり ${deltaMs}ms`,
    );
    expect(full.calls.length).toBeGreaterThanOrEqual(3);
    expect(delta.calls).toHaveLength(1);
    expect(deltaCount).toBeLessThan(fullCount / 5);
    expect(delta.kb).toBeLessThan(full.kb / 5);
    expect(deltaMs).toBeLessThan(fullMs / 4);
  });

  it("差分の問い合わせは、前に読んだ時刻（とその1時間前の早い方）より後に更新された物と、開いている物だけを頼む", async () => {
    const before = bigRepo();
    await read(before, T0);
    const t1 = T0 + 10 * MIN;
    const { calls } = await read(before, t1);
    expect(calls[0].variables).toMatchObject({
      since: at(t1 - HOUR),
      withRecentIssues: true,
      withOpenIssues: true,
      withRecentPulls: true,
      withOpenPulls: true,
      withMain: true,
    });
  });

  it("更新時刻が動かない変化（開いている PR のチェックの終わり・マージ直後の公開のステータス）も、差分で読み直す", async () => {
    const before = bigRepo();
    await read(before, T0);
    const t1 = T0 + 10 * MIN;
    const openPull = before.pulls[0];
    const changed: FakeRepo = {
      issues: before.issues,
      pulls: [
        {
          ...openPull,
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: { nodes: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "FAILURE", completedAt: at(t1) }] },
                  },
                },
              },
            ],
          },
        },
        ...before.pulls.slice(1),
      ],
    };
    const { result } = await read(changed, t1);
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.sync?.mode).toBe("delta");
    expect(result.data.pullChecks[openPull.number].checkRuns[0].conclusion).toBe("failure");
  });

  it("差分の問い合わせ1回の点数は、全部の読みの1回目（8点）以下", () => {
    expect(deltaQueryCost({ recentIssues: true, openIssues: true, recentPulls: true, openPulls: true, withMain: true })).toBeLessThanOrEqual(8);
  });

  it("6時間に1回は全部を読み直す（削除された物の取りこぼしを片づける）", async () => {
    const before = bigRepo();
    await read(before, T0);
    const second = await read(before, T0 + FULL_READ_INTERVAL_MS - MIN);
    expect(second.result.ok && second.result.data.sync?.mode).toBe("delta");
    const third = await read(before, T0 + FULL_READ_INTERVAL_MS);
    expect(third.result.ok && third.result.data.sync).toMatchObject({ mode: "full", fullAt: at(T0 + FULL_READ_INTERVAL_MS) });
  });

  it("全部を読み直すと、削除された物は消える（差分のままだと残る）", async () => {
    const before = bigRepo();
    await read(before, T0);
    const removed = { issues: before.issues.slice(1), pulls: before.pulls };
    const delta = await read(removed, T0 + 10 * MIN);
    expect(delta.result.ok && delta.result.data.issues.some((i) => i.number === before.issues[0].number)).toBe(true);
    const full = await read(removed, T0 + FULL_READ_INTERVAL_MS);
    expect(full.result.ok && full.result.data.issues.some((i) => i.number === before.issues[0].number)).toBe(false);
  });

  it("差分の読みが失敗したら、その回のうちに全部を読み直す", async () => {
    const before = bigRepo();
    await read(before, T0);
    let deltaTried = 0;
    const { fetcher, calls } = fakeGitHub({ "o/r": before });
    const failing: typeof fetch = async (input, init) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { variables?: Record<string, unknown> }) : null;
      if (body?.variables && "withRecentIssues" in body.variables) {
        deltaTried++;
        return jsonResponse({ message: "boom" }, { status: 502 });
      }
      return fetcher(input, init);
    };
    const [result] = await fetchAllRepos(TOKEN, REPOS, { fetcher: failing, now: new Date(T0 + 10 * MIN) });
    expect(deltaTried).toBe(1);
    expect(result.ok && result.data.sync?.mode).toBe("full");
    expect(graphqlCalls(calls).length).toBeGreaterThanOrEqual(3);
  });

  it("回数制限で失敗したときは、全部を読み直さずにエラーにする", async () => {
    const before = bigRepo();
    await read(before, T0);
    let tried = 0;
    const limited: typeof fetch = async (input) => {
      if (!String(input).endsWith("/graphql")) return jsonResponse({ total_count: 0, workflow_runs: [] });
      tried++;
      return jsonResponse({ data: null, errors: [{ type: "RATE_LIMITED", message: "x" }] });
    };
    const [result] = await fetchAllRepos(TOKEN, REPOS, { fetcher: limited, now: new Date(T0 + 10 * MIN) });
    expect(result.ok).toBe(false);
    // GraphQL は差分の1回だけ
    expect(tried).toBe(1);
  });

  it("差分の読みで、開いている物が最大のページ数を超えたら全部を読む", async () => {
    const before = bigRepo();
    await read(before, T0);
    const manyOpen = Array.from({ length: 520 }, (_, i) =>
      gqlIssue(5000 + i, { updatedAt: at(T0 - 3 * HOUR - i * MIN) }),
    );
    const { result } = await read({ issues: [...before.issues, ...manyOpen], pulls: before.pulls }, T0 + 10 * MIN);
    expect(result.ok && result.data.sync?.mode).toBe("full");
  });
});
