import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  installation: { repositories: [{ name: "agent-desk", owner: { login: "acme" } }] } as unknown,
  keyAppId: 123 as number | null,
  reads: 0,
}));

vi.mock("@/lib/github/selfcheck", () => ({
  fetchInstallationRepositories: async () => state.installation,
  fetchPipelineInstallationAppId: async () => state.keyAppId,
  readWatchedVariableWith: async () => null,
}));
vi.mock("@/lib/github/fetch", () => ({
  getRepoResult: async (_token: string, repo: { owner: string; repo: string }) => {
    state.reads += 1;
    return {
      ...repo,
      ok: true,
      data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], runs: [] },
    };
  },
}));

const { POST } = await import("./route");
const { clearSelfcheckMemoForTest } = await import("@/lib/selfcheck/run");

function call(authorization?: string): Promise<Response> {
  return POST(
    new Request("https://desk.example/api/selfcheck", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );
}

beforeEach(() => {
  state.installation = { repositories: [{ name: "agent-desk", owner: { login: "acme" } }] };
  state.keyAppId = 123;
  state.reads = 0;
  process.env.PIPELINE_APP_ID = "123";
  process.env.WATCHED_REPOS = "acme/agent-desk";
  delete process.env.SETTINGS_REPO;
  clearSelfcheckMemoForTest();
});

describe("POST /api/selfcheck", () => {
  it("鍵が無ければ 401（本文なし）", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(state.reads).toBe(0);
  });

  it("違う App の鍵は 401", async () => {
    state.keyAppId = 999;
    expect((await call("Bearer secret-key")).status).toBe(401);
    expect(state.reads).toBe(0);
  });

  it("監視していないリポジトリの鍵は 401", async () => {
    state.installation = { repositories: [{ name: "elsewhere", owner: { login: "acme" } }] };
    expect((await call("Bearer secret-key")).status).toBe(401);
  });

  it("GitHub が鍵を受け付けなければ 401", async () => {
    state.installation = null;
    expect((await call("Bearer secret-key")).status).toBe(401);
  });

  it("PIPELINE_APP_ID が無ければ 401", async () => {
    delete process.env.PIPELINE_APP_ID;
    expect((await call("Bearer secret-key")).status).toBe(401);
  });

  it("受け付けると、返事の形で返す。鍵は返事に入れない", async () => {
    const response = await call("Bearer secret-key");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("secret-key");
    const body = JSON.parse(text) as { checkedAt: string; repoCount: number; unreadable: string[]; drifts: unknown[] };
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "drifts", "repoCount", "unreadable"]);
    expect(body.repoCount).toBe(1);
    expect(body.unreadable).toEqual([]);
    expect(body.drifts).toEqual([]);
  });

  it("5分のうちに2回呼んでも、GitHub を読み直さない", async () => {
    await call("Bearer secret-key");
    await call("Bearer secret-key");
    expect(state.reads).toBe(1);
  });
});
