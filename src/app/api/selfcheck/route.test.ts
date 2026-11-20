import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  installation: { repositories: [{ name: "agent-desk", owner: { login: "acme" } }] } as unknown,
  keyAppId: 123 as number | null,
  reads: 0,
  usageCalls: [] as string[],
  writable: true,
  issues: new Map() as Map<string, { number: number; totalMs: number }> | null,
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

vi.mock("@/lib/selfcheck/publish", () => ({ publishDriftIssues: async () => undefined }));
vi.mock("@/lib/github/usageIssue", () => ({
  listUsageIssues: async () => {
    state.usageCalls.push("list");
    return state.issues;
  },
  createUsageIssue: async (_t: string, _r: unknown, title: string, body: string) => {
    state.usageCalls.push(`create ${title}`);
    if (state.writable) state.issues?.set(title.replace("使用量：", ""), { number: 1, totalMs: Number(/：(\d+)/.exec(body)?.[1]) });
    return state.writable;
  },
  updateIssueBody: async () => {
    state.usageCalls.push("update");
    return state.writable;
  },
}));

const { POST } = await import("./route");
const { clearSelfcheckMemoForTest } = await import("@/lib/selfcheck/run");
const { clearUsageStateForTest } = await import("@/lib/usage/record");

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
  state.usageCalls = [];
  state.writable = true;
  state.issues = new Map();
  clearSelfcheckMemoForTest();
  clearUsageStateForTest();
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
    expect(Object.keys(body).sort()).toEqual(["budget", "checkedAt", "drifts", "repoCount", "unreadable", "usage"]);
    expect(body.repoCount).toBe(1);
    expect(body.unreadable).toEqual([]);
    expect(body.drifts).toEqual([]);
  });

  it("401 では使用量を読まない・書かない", async () => {
    process.env.SETTINGS_REPO = "acme/settings";
    await call();
    state.keyAppId = 999;
    await call("Bearer secret-key");
    expect(state.usageCalls).toEqual([]);
  });

  it("SETTINGS_REPO が無ければ usage: null・budget: unknown", async () => {
    const body = (await (await call("Bearer secret-key")).json()) as { usage: unknown; budget: string };
    expect(body.usage).toBeNull();
    expect(body.budget).toBe("unknown");
    expect(state.usageCalls).toEqual([]);
  });

  it("使用量の Issue に書き、usage と budget を返す。記憶から返った呼び出しでも数える", async () => {
    process.env.SETTINGS_REPO = "acme/settings";
    const first = (await (await call("Bearer secret-key")).json()) as {
      usage: { todayMs: number; avg7Ms: number; ratio: number };
      budget: string;
    };
    expect(state.usageCalls[0]).toBe("list");
    expect(state.usageCalls[1]).toMatch(/^create 使用量：\d{4}-\d{2}-\d{2}$/);
    expect(first.usage.todayMs).toBeGreaterThan(0);
    expect(first.usage.ratio).toBeCloseTo(first.usage.todayMs / 240000);
    expect(first.budget).toBe(first.usage.ratio >= 1 ? "over" : first.usage.ratio >= 0.5 ? "warn" : "ok");
    const callsAfterFirst = state.usageCalls.length;
    await call("Bearer secret-key");
    expect(state.reads).toBe(1);
    // 10分未満の2回目は読むだけで書かない
    expect(state.usageCalls.slice(callsAfterFirst)).toEqual(["list"]);
  });

  it("書けない（403 など）ときも落ちず、usage: null・budget: unknown で今までの返事を返す", async () => {
    process.env.SETTINGS_REPO = "acme/settings";
    state.writable = false;
    const response = await call("Bearer secret-key");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { usage: unknown; budget: string; repoCount: number };
    expect(body.usage).toBeNull();
    expect(body.budget).toBe("unknown");
    expect(body.repoCount).toBe(1);
  });

  it("読めない（403 など）ときも落ちない", async () => {
    process.env.SETTINGS_REPO = "acme/settings";
    state.issues = null;
    const body = (await (await call("Bearer secret-key")).json()) as { usage: unknown; budget: string };
    expect(body.usage).toBeNull();
    expect(body.budget).toBe("unknown");
  });

  it("5分のうちに2回呼んでも、GitHub を読み直さない", async () => {
    await call("Bearer secret-key");
    await call("Bearer secret-key");
    expect(state.reads).toBe(1);
  });
});
