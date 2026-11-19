import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  login: "owner1" as string | null,
  token: "secret-token" as string | null,
  repos: [
    { owner: "acme", repo: "private-name-a" },
    { owner: "acme", repo: "private-name-b" },
  ],
  webhook: true,
}));

vi.mock("@/lib/auth", () => ({
  getSignedInLogin: async () => state.login,
  getGitHubToken: async () => state.token,
}));
vi.mock("@/lib/watchedRepos", () => ({
  loadWatchedRepos: async () => ({ repos: state.repos, source: "env" }),
}));
vi.mock("@/lib/github/fetch", () => ({
  getRepoResult: async (_token: string, repo: { owner: string; repo: string }) => ({
    ...repo,
    ok: true,
    readSource: "app",
    data: {
      issues: [{ title: "private-title" }],
      sync: { mode: repo.repo.endsWith("a") ? "delta" : "full", readAt: "x", fullAt: "x", count: 7 },
    },
  }),
}));
vi.mock("@/lib/github/repoCache", () => ({
  getChangeMarks: async () => ({}),
  isWebhookEnabled: () => state.webhook,
}));

const { GET } = await import("./route");

beforeEach(() => {
  state.login = "owner1";
  state.token = "secret-token";
  state.webhook = true;
});

describe("GET /api/timing", () => {
  it("ログインしていなければ 401（何も測らず、ヘッダーも付けない）", async () => {
    state.login = null;
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.headers.get("Server-Timing")).toBeNull();
  });

  it("段の名前と ms を、ページと同じ順に `Server-Timing` と本文で返す", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const header = response.headers.get("Server-Timing") ?? "";
    expect(header.split(", ").map((part) => part.split(";")[0])).toEqual([
      "auth",
      "watched",
      "token",
      "marks",
      "first-repo",
      "repos",
      "build",
      "slowest-repo",
      "gh-graphql",
      "gh-rest",
      "gh-key",
      "total",
      "instance",
    ]);
    for (const part of header.split(", ")) expect(part).toMatch(/^[a-z0-9-]+;dur=\d+(\.\d)?$/);
    const body = (await response.json()) as {
      stages: { name: string; ms: number; label: string }[];
      repoCount: number;
      repos: { n: number; ms: number; ok: boolean; source: string; kb: number; mode: string; count: number }[];
      calls: Record<string, { count: number; ms: number; maxMs: number }>;
    };
    expect(body.repos.map((row) => [row.n, row.ok, row.source, row.mode, row.count])).toEqual([
      [1, true, "app", "delta", 7],
      [2, true, "app", "full", 7],
    ]);
    expect(Object.keys(body.calls).sort()).toEqual(["graphql", "key", "rest", "write"]);
    expect(body.stages.map((stage) => stage.name)).toEqual(header.split(", ").map((part) => part.split(";")[0]));
    expect(body.stages.every((stage) => stage.label !== "" && stage.ms >= 0)).toBe(true);
    expect(body.repoCount).toBe(2);
  });

  it("トークン・リポジトリの名前は、ヘッダーにも本文にも入れない", async () => {
    const response = await GET();
    const text = `${response.headers.get("Server-Timing")} ${await response.text()}`;
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("private-name");
    expect(text).not.toContain("acme");
    expect(text).not.toContain("private-title");
  });

  it("Webhook を使わない設定では `marks` を測らない", async () => {
    state.webhook = false;
    const header = (await GET()).headers.get("Server-Timing") ?? "";
    expect(header).not.toContain("marks");
    expect(header).toContain("first-repo");
  });
});
