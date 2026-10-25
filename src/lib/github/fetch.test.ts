import { describe, expect, it } from "vitest";
import { GitHubClient, parseNextLink } from "./client";
import { classifyError, GitHubError } from "./errors";
import { fetchAllRepos } from "./fetch";

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

describe("parseNextLink", () => {
  it("GitHub以外のURLは辿らない", () => {
    expect(parseNextLink('<https://evil.example/x>; rel="next"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
  });
});

/** リポジトリ `ok/repo` はデータを返し、`ng/repo` は指定のステータスで失敗する偽のGitHub */
function fakeGitHub(failStatus: number): typeof fetch {
  return async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.startsWith("/repos/ng/")) return json({ message: "x" }, { status: failStatus });
    if (path.endsWith("/issues")) {
      return json([
        {
          number: 1,
          title: "issue",
          state: "open",
          labels: [],
          html_url: "u",
          created_at: "2026-10-20T00:00:00Z",
          updated_at: "2026-10-20T00:00:00Z",
        },
        {
          number: 2,
          title: "pr as issue",
          state: "open",
          pull_request: {},
          html_url: "u",
          created_at: "2026-10-20T00:00:00Z",
          updated_at: "2026-10-20T00:00:00Z",
        },
      ]);
    }
    if (path.endsWith("/pulls")) {
      return json([
        {
          number: 2,
          title: "pr",
          state: "closed",
          merged_at: "2026-10-21T00:00:00Z",
          html_url: "u",
          head: { ref: "claude/issue-1-x", sha: "headsha" },
          merge_commit_sha: "mergesha",
          created_at: "2026-10-20T00:00:00Z",
          updated_at: "2026-10-21T00:00:00Z",
        },
        {
          number: 9,
          title: "old",
          state: "closed",
          html_url: "u",
          head: { ref: "b", sha: "oldsha" },
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ]);
    }
    if (path.endsWith("/issues/comments")) return json([]);
    if (path.endsWith("/issues/events")) {
      return json([
        { event: "labeled", label: { name: "ai:implement" }, issue: { number: 1 }, created_at: "t" },
      ]);
    }
    if (path.endsWith("/commits/headsha/check-runs")) {
      return json({
        check_runs: [
          {
            name: "test",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
            completed_at: "2026-10-20T01:00:00Z",
          },
        ],
      });
    }
    if (path.endsWith("/commits/mergesha/status")) {
      return json({
        statuses: [{ context: "Vercel", state: "success", updated_at: "2026-10-21T00:05:00Z" }],
      });
    }
    return json({ message: "unexpected" }, { status: 500 });
  };
}

describe("fetchAllRepos", () => {
  it("リポジトリのデータを自前の型にして返す", async () => {
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], {
      fetcher: fakeGitHub(404),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.issues.map((i) => i.number)).toEqual([1]);
    expect(result.data.pulls.map((p) => p.number)).toEqual([2]);
    expect(result.data.pullChecks[2].checkRuns[0].appSlug).toBe("github-actions");
    expect(result.data.pullChecks[2].statuses[0].updatedAt).toBe("2026-10-21T00:05:00Z");
    expect(result.data.events).toHaveLength(1);
  });

  it("1つのリポジトリが失敗しても、ほかは取れる", async () => {
    const results = await fetchAllRepos(
      TOKEN,
      [
        { owner: "ng", repo: "repo" },
        { owner: "ok", repo: "repo" },
      ],
      { fetcher: fakeGitHub(403), now: NOW },
    );
    const [failed, succeeded] = results;
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe("forbidden");
      expect(failed.error.message).not.toContain(TOKEN);
    }
    expect(succeeded.ok).toBe(true);
  });
});
