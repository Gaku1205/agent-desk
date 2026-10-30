import { beforeEach, describe, expect, it } from "vitest";
import {
  ETAG_CACHE_MAX_ENTRIES,
  etagCacheForTest,
  GitHubClient,
  parseNextLink,
} from "./client";
import { classifyError, GitHubError } from "./errors";
import { fakeGitHub, gqlIssue, gqlPull, jsonResponse, type FakeRepo } from "./fakeGitHub";
import { actionsCacheForTest, fetchAllRepos, mainDeployedCacheForTest } from "./fetch";

const TOKEN = "ghp_secret_token_value";
const NOW = new Date("2026-10-25T00:00:00Z");

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("classifyError", () => {
  it("ステータスごとに種類を分ける", () => {
    expect(classifyError(401, new Headers())).toBe("unauthorized");
    expect(classifyError(403, new Headers())).toBe("forbidden");
    expect(classifyError(404, new Headers())).toBe("not_found");
    expect(classifyError(429, new Headers())).toBe("rate_limited");
    expect(classifyError(500, new Headers())).toBe("other");
  });

  it("403でも残り回数が0ならレート制限", () => {
    expect(classifyError(403, new Headers({ "x-ratelimit-remaining": "0" }))).toBe(
      "rate_limited",
    );
    expect(classifyError(403, new Headers({ "retry-after": "60" }))).toBe("rate_limited");
  });
});

describe("GitHubClient", () => {
  it("認証ヘッダーを付けて呼ぶ", async () => {
    let seen: Headers | undefined;
    const client = new GitHubClient(TOKEN, async (_url, init) => {
      seen = new Headers(init?.headers);
      return json({ ok: true });
    });
    await client.get("/repos/o/r/issues");
    expect(seen?.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    [401, "unauthorized", "認証が切れ"],
    [403, "forbidden", "権限がありません"],
    [404, "not_found", "見つかりません"],
    [429, "rate_limited", "レート制限"],
    [500, "other", "取れませんでした"],
  ])("%i は %s のエラーになる（日本語の理由、トークンなし）", async (status, kind, text) => {
    const client = new GitHubClient(TOKEN, async () =>
      json({ message: `bad ${TOKEN}` }, { status }),
    );
    const error = await client.get("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    const e = error as GitHubError;
    expect(e.kind).toBe(kind);
    expect(e.message).toContain(text);
    expect(e.message).not.toContain(TOKEN);
  });

  it("通信エラーは other で、元のエラー文（トークンを含みうる）を引き継がない", async () => {
    const client = new GitHubClient(TOKEN, async () => {
      throw new Error(`failed with ${TOKEN}`);
    });
    const e = (await client.get("/x").catch((err: unknown) => err)) as GitHubError;
    expect(e.kind).toBe("other");
    expect(e.message).not.toContain(TOKEN);
  });

  it("Link ヘッダーの次のページまで取る", async () => {
    const urls: string[] = [];
    const client = new GitHubClient(TOKEN, async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return json([1], {
          headers: { link: '<https://api.github.com/p2>; rel="next"' },
        });
      }
      return json([2]);
    });
    expect(await client.getAll<number>("/p1")).toEqual([1, 2]);
    expect(urls).toEqual(["https://api.github.com/p1", "https://api.github.com/p2"]);
  });
});

describe("GitHubClient の GraphQL", () => {
  it("POST /graphql に問い合わせと変数を送り、data を返す", async () => {
    let seen: { url: string; method?: string; auth: string | null; body: unknown } | undefined;
    const client = new GitHubClient(TOKEN, async (url, init) => {
      seen = {
        url: String(url),
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      };
      return json({ data: { repository: { isTemplate: true } } });
    });
    expect(await client.graphql("query { x }", { a: 1 })).toEqual({ repository: { isTemplate: true } });
    expect(seen).toEqual({
      url: "https://api.github.com/graphql",
      method: "POST",
      auth: `Bearer ${TOKEN}`,
      body: { query: "query { x }", variables: { a: 1 } },
    });
  });

  it.each([
    ["RATE_LIMITED", "rate_limited"],
    ["NOT_FOUND", "not_found"],
    ["FORBIDDEN", "forbidden"],
    ["SOMETHING", "other"],
  ])("errors の type が %s なら %s のエラー（トークンなし）", async (type, kind) => {
    const client = new GitHubClient(TOKEN, async () =>
      json({ data: null, errors: [{ type, message: `bad ${TOKEN}` }] }),
    );
    const e = (await client.graphql("q", {}).catch((err: unknown) => err)) as GitHubError;
    expect(e).toBeInstanceOf(GitHubError);
    expect(e.kind).toBe(kind);
    expect(e.message).not.toContain(TOKEN);
  });

  it("HTTP のエラーは REST と同じ分け方", async () => {
    const client = new GitHubClient(TOKEN, async () => json({}, { status: 401 }));
    const e = (await client.graphql("q", {}).catch((err: unknown) => err)) as GitHubError;
    expect(e.kind).toBe("unauthorized");
  });
});

describe("GitHubClient のETag", () => {
  beforeEach(() => etagCacheForTest.clear());

  it("2回目から If-None-Match を付け、304 のときは前回の中身と次ページを使う", async () => {
    const seen: (string | null)[] = [];
    const client = new GitHubClient(TOKEN, async (_url, init) => {
      const inm = new Headers(init?.headers).get("if-none-match");
      seen.push(inm);
      if (inm === '"v1"') return new Response(null, { status: 304 });
      return json([1], {
        headers: { etag: '"v1"', link: '<https://api.github.com/p2>; rel="next"' },
      });
    });
    const first = await client.request("/p1");
    const second = await client.request("/p1");
    expect(seen).toEqual([null, '"v1"']);
    expect(second).toEqual(first);
    expect(second).toEqual({ json: [1], next: "https://api.github.com/p2" });
  });

  it("内容が変わっていれば新しい中身と新しいETagに替わる", async () => {
    let n = 0;
    const seen: (string | null)[] = [];
    const client = new GitHubClient(TOKEN, async (_url, init) => {
      seen.push(new Headers(init?.headers).get("if-none-match"));
      n++;
      return json({ n }, { headers: { etag: `"v${n}"` } });
    });
    await client.get("/x");
    expect(await client.get("/x")).toEqual({ n: 2 });
    await client.get("/x");
    expect(seen).toEqual([null, '"v1"', '"v2"']);
  });

  it("キーにトークンそのものは入らず、トークンが違えば別に覚える", async () => {
    const fetcher: typeof fetch = async () => json([], { headers: { etag: '"a"' } });
    await new GitHubClient(TOKEN, fetcher).get("/x");
    await new GitHubClient("other_token", fetcher).get("/x");
    const keys = etagCacheForTest.keys();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain(TOKEN);
      expect(key).not.toContain("other_token");
    }
  });

  it("覚える件数には上限がある", async () => {
    const client = new GitHubClient(TOKEN, async () => json([], { headers: { etag: '"a"' } }));
    for (let i = 0; i < ETAG_CACHE_MAX_ENTRIES + 10; i++) await client.get(`/x/${i}`);
    expect(etagCacheForTest.keys()).toHaveLength(ETAG_CACHE_MAX_ENTRIES);
  });

  it("書き込み（send）には If-None-Match を付けない", async () => {
    let inm: string | null = "unset";
    await new GitHubClient(TOKEN, async (_url, init) => {
      if (init?.method === "POST") inm = new Headers(init.headers).get("if-none-match");
      return json({}, { headers: { etag: '"a"' } });
    }).send("POST", "/x", {});
    expect(inm).toBeNull();
  });
});

describe("parseNextLink", () => {
  it("GitHub以外のURLは辿らない", () => {
    expect(parseNextLink('<https://evil.example/x>; rel="next"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
  });
});

/** `ok/repo` の中身：Issue 1件、マージ済みでIssueに紐づくPR 1件と古いPR 1件、ラベルの付け外し1件 */
function okRepo(main: FakeRepo["main"] = [[{ context: "Vercel", state: "SUCCESS", createdAt: "2026-10-21T01:00:00Z" }]]): FakeRepo {
  return {
    issues: [
      gqlIssue(1, {
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-20T00:00:00Z",
        timelineItems: {
          nodes: [{ __typename: "LabeledEvent", createdAt: "2026-10-20T00:00:00Z", label: { name: "ai:implement" } }],
        },
      }),
    ],
    pulls: [
      gqlPull(2, {
        merged: true,
        mergedAt: "2026-10-21T00:00:00Z",
        headRefName: "claude/issue-1-x",
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-21T00:00:00Z",
        statuses: [{ context: "Vercel", state: "SUCCESS", createdAt: "2026-10-21T00:05:00Z" }],
      }),
      gqlPull(9, { state: "CLOSED", headRefName: "b", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" }),
    ],
    main,
  };
}

describe("fetchAllRepos", () => {
  beforeEach(() => {
    etagCacheForTest.clear();
    mainDeployedCacheForTest.clear();
    actionsCacheForTest.clear();
  });

  it("リポジトリのデータを自前の型にして返す", async () => {
    const { fetcher } = fakeGitHub({ "ok/repo": { ...okRepo(), isTemplate: true } });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], { fetcher, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.issues.map((i) => i.number)).toEqual([1]);
    expect(result.data.pulls.map((p) => p.number)).toEqual([2]);
    // マージ済みのPRは、公開ステータスだけ（チェックランは空）
    expect(result.data.pullChecks[2].checkRuns).toEqual([]);
    expect(result.data.pullChecks[2].statuses[0].updatedAt).toBe("2026-10-21T00:05:00Z");
    expect(result.data.events).toEqual([
      { event: "labeled", labelName: "ai:implement", issueNumber: 1, createdAt: "2026-10-20T00:00:00Z" },
    ]);
    expect(result.data.isTemplate).toBe(true);
    expect(result.data.pipeline).toBe("running");
  });

  it("問い合わせの since は日の始めに切り下げ、14日より古い物は結果に入らない", async () => {
    const repo: FakeRepo = {
      issues: [
        gqlIssue(1, {
          updatedAt: "2026-10-20T00:00:00Z",
          comments: {
            nodes: [
              { databaseId: 10, createdAt: "2026-10-11T06:00:00Z", author: null },
              { databaseId: 11, createdAt: "2026-10-12T00:00:00Z", author: null },
            ],
          },
        }),
        gqlIssue(3, { updatedAt: "2026-10-11T06:00:00Z" }),
      ],
    };
    const { fetcher, calls } = fakeGitHub({ "ok/repo": repo });
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], {
      fetcher,
      now: new Date("2026-10-25T12:00:00Z"),
    });
    expect(calls.find((c) => c.variables)?.variables?.since).toBe("2026-10-11T00:00:00.000Z");
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.issues.map((i) => i.number)).toEqual([1]);
    expect(result.data.comments.map((c) => c.id)).toEqual([11]);
  });

  describe("main の最後に公開が成功した時刻", () => {
    const repo = [{ owner: "ok", repo: "repo" }];
    const mainDeployedAt = async (main: FakeRepo["main"]) => {
      const { fetcher } = fakeGitHub({ "ok/repo": okRepo(main) });
      const [result] = await fetchAllRepos(TOKEN, repo, { fetcher, now: NOW });
      if (!result.ok) throw new Error("取れていない");
      return result.data.mainDeployedAt;
    };
    const pending = { context: "Vercel", state: "PENDING", createdAt: "2026-10-21T03:00:00Z" };

    it("いちばん新しいコミットが pending でも、1つ前のコミットが success ならその時刻を使う", async () => {
      const at = await mainDeployedAt([
        [pending],
        [{ context: "Vercel", state: "SUCCESS", createdAt: "2026-10-21T02:00:00Z" }],
      ]);
      expect(at).toBe("2026-10-21T02:00:00Z");
    });

    it("直近10件に成功が無ければ null", async () => {
      expect(await mainDeployedAt([[pending]])).toBeNull();
    });

    it("main が取れなかったら前回の値を使う（前回の値が無ければ null）", async () => {
      expect(await mainDeployedAt(null)).toBeNull();
      expect(await mainDeployedAt([])).toBeNull();
      expect(
        await mainDeployedAt([[{ context: "Vercel", state: "SUCCESS", createdAt: "2026-10-21T01:00:00Z" }]]),
      ).toBe("2026-10-21T01:00:00Z");
      expect(await mainDeployedAt(null)).toBe("2026-10-21T01:00:00Z");
    });
  });

  describe("見張り役（watchdog.yml）の最後の実行", () => {
    async function watchdogOf(respond: () => Response) {
      const { fetcher } = fakeGitHub({ "ok/repo": okRepo() }, (url) =>
        url.pathname.endsWith("/actions/workflows/watchdog.yml/runs") ? respond() : undefined,
      );
      actionsCacheForTest.clear();
      const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], { fetcher, now: NOW });
      expect(result.ok).toBe(true);
      return result.ok ? result.data : null;
    }

    it("実行が1件あれば created_at を最後の実行の時刻にする", async () => {
      const data = await watchdogOf(() =>
        json({ total_count: 5, workflow_runs: [{ created_at: "2026-10-20T00:00:00Z" }] }),
      );
      expect(data?.watchdog).toEqual({ at: "2026-10-20T00:00:00Z" });
    });

    it("404（watchdog.yml が無い）は「無い」", async () => {
      const data = await watchdogOf(() => json({ message: "Not Found" }, { status: 404 }));
      expect(data?.watchdog).toBe("none");
    });

    it("実行が0件は「無い」", async () => {
      const data = await watchdogOf(() => json({ total_count: 0, workflow_runs: [] }));
      expect(data?.watchdog).toBe("none");
    });

    it("取れない・形が違うときは「分からない」で、ほかのデータは取れる", async () => {
      for (const respond of [
        () => json({ message: "x" }, { status: 500 }),
        () => json({ workflow_runs: [{ created_at: 123 }] }),
        () => json({ foo: 1 }),
      ]) {
        const data = await watchdogOf(respond);
        expect(data?.watchdog).toBe("unknown");
        expect(data?.issues.map((i) => i.number)).toEqual([1]);
      }
    });
  });

  it("パイプラインの pipeline.yml が無い（404）なら「動いていない」", async () => {
    const { fetcher } = fakeGitHub({ "ok/repo": okRepo() }, (url) =>
      url.pathname.endsWith("/actions/workflows/pipeline.yml/runs")
        ? json({ message: "Not Found" }, { status: 404 })
        : undefined,
    );
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], { fetcher, now: NOW });
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pipeline).toBe("notConfigured");
  });

  it("1つのリポジトリが失敗しても、ほかは取れる", async () => {
    const { fetcher } = fakeGitHub({
      "ng/repo": () => jsonResponse({ message: `bad ${TOKEN}` }, { status: 403 }),
      "ok/repo": okRepo(),
    });
    const results = await fetchAllRepos(
      TOKEN,
      [
        { owner: "ng", repo: "repo" },
        { owner: "ok", repo: "repo" },
      ],
      { fetcher, now: NOW },
    );
    const [failed, succeeded] = results;
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe("forbidden");
      expect(failed.error.message).not.toContain(TOKEN);
    }
    expect(succeeded.ok).toBe(true);
  });

  it("見つからないリポジトリ（repository が null）は not_found", async () => {
    const { fetcher } = fakeGitHub({});
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "x", repo: "y" }], { fetcher, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });
});
