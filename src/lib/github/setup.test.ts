import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSetupState, signSetupState, usedCodesForTest } from "../setupCookie";
import { SETUP_MESSAGES } from "../setupState";
import { GitHubClient } from "./client";
import {
  completeManifest,
  dispatchDoctor,
  enableDeleteBranch,
  generateSetupRepo,
  handleManifestReturn,
  loadSetupFacts,
  saveClaudeToken,
  saveExistingApp,
} from "./setup";
import { loadSodium } from "./sodium";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const CLAUDE_TOKEN = "sk-ant-oat01-very-secret-token";
const SECRET = "auth-secret";
const NOW = Date.parse("2026-11-18T10:00:00Z");

type Call = { method: string; path: string; body: string | null };

/** 偽の GitHub。呼ばれた物を全部覚える */
async function fakeGitHub(options: { conversionStatus?: number; secretPutStatus?: number } = {}) {
  const sodium = await loadSodium();
  const pair = sodium.crypto_box_keypair();
  const publicKey = sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL);
  const calls: Call[] = [];
  const repos: Record<string, unknown> = {
    "/repos/Gaku1205/my-app": {
      full_name: "Gaku1205/my-app",
      owner: { login: "Gaku1205" },
      template_repository: { full_name: "Gaku1205/ai-dev-template" },
      delete_branch_on_merge: false,
      default_branch: "main",
    },
    "/repos/Gaku1205/plain": {
      full_name: "Gaku1205/plain",
      owner: { login: "Gaku1205" },
      template_repository: null,
    },
    "/repos/someone/app": {
      full_name: "someone/app",
      owner: { login: "someone" },
      template_repository: { full_name: "Gaku1205/ai-dev-template" },
    },
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    calls.push({ method, path, body: typeof init?.body === "string" ? init.body : null });
    if (method === "GET" && repos[path]) return json(repos[path]);
    if (method === "GET" && path.startsWith("/repos/") && path.split("/").length === 4) return json({}, 404);
    if (method === "POST" && path.startsWith("/app-manifests/")) {
      if (options.conversionStatus) return json({ message: "bad" }, options.conversionStatus);
      return json({
        id: 42,
        slug: "gaku1205-ai-pipeline",
        pem: PEM,
        client_secret: "client-secret-value",
        webhook_secret: "webhook-secret-value",
      }, 201);
    }
    if (path.endsWith("/actions/secrets/public-key")) return json({ key_id: "k1", key: publicKey });
    if (method === "PUT" && path.includes("/actions/secrets/")) {
      return new Response(null, { status: options.secretPutStatus ?? 201 });
    }
    if (method === "GET" && path.includes("/actions/variables/")) return json({ message: "Not Found" }, 404);
    if (method === "POST" && path.endsWith("/actions/variables")) return new Response(null, { status: 201 });
    if (method === "GET" && path === "/app") return json({ id: 42, slug: "gaku1205-ai-pipeline" });
    if (method === "GET" && path.endsWith("/installation")) return json({ id: 7 });
    if (method === "PATCH") return json({});
    if (method === "POST" && path.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (method === "POST" && path.endsWith("/generate")) return json({ full_name: "Gaku1205/new-app" }, 201);
    if (path.endsWith("/actions/secrets")) return json({ secrets: [{ name: "CLAUDE_CODE_OAUTH_TOKEN" }] });
    if (path.includes("/workflows/doctor.yml/runs")) return json({ workflow_runs: [] });
    return json({}, 404);
  }) as typeof fetch;
  const writes = () => calls.filter((call) => call.method !== "GET");
  const open = (sealed: string) =>
    sodium.to_string(
      sodium.crypto_box_seal_open(
        sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL),
        pair.publicKey,
        pair.privateKey,
      ),
    );
  return { fetcher, calls, writes, open, client: new GitHubClient(`token-${Math.random()}`, fetcher) };
}

const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  usedCodesForTest.clear();
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
});

afterEach(() => {
  // 秘密鍵・トークンは、どのログにも出ない
  for (const spy of consoleSpies) {
    const text = JSON.stringify(spy.mock.calls);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain(CLAUDE_TOKEN);
    spy.mockRestore();
  }
  consoleSpies.length = 0;
});

/** 秘密が、返す物のどこにも入っていない */
function expectNoSecret(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain("PRIVATE KEY");
  expect(text).not.toContain(PEM.slice(40, 80));
  expect(text).not.toContain(CLAUDE_TOKEN);
  expect(text).not.toContain("client-secret-value");
  expect(text).not.toContain("webhook-secret-value");
}

describe("completeManifest（App を作って戻ったとき）", () => {
  it("秘密鍵を Secret に、App ID と slug を Variable に書き、返す物に鍵は入らない", async () => {
    const gh = await fakeGitHub();
    const result = await completeManifest({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", code: "c1", fetcher: gh.fetcher });
    expect(result).toEqual({ ok: true });
    expectNoSecret(result);

    const put = gh.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe("/repos/Gaku1205/my-app/actions/secrets/PIPELINE_APP_PRIVATE_KEY");
    // 送るのは暗号にした値だけで、鍵そのものは送らない
    expect(put?.body).not.toContain("PRIVATE KEY");
    expect(gh.open((JSON.parse(put?.body ?? "{}") as { encrypted_value: string }).encrypted_value)).toBe(PEM);

    const variables = gh.calls.filter((call) => call.method === "POST" && call.path.endsWith("/actions/variables"));
    expect(variables.map((call) => JSON.parse(call.body ?? "{}"))).toEqual([
      { name: "PIPELINE_APP_ID", value: "42" },
      { name: "PIPELINE_APP_SLUG", value: "gaku1205-ai-pipeline" },
    ]);
    // ほかの秘密（client_secret・webhook_secret）はどこにも書かない
    for (const call of gh.calls) expectNoSecret({ body: call.body?.replace(/"encrypted_value":"[^"]*"/, "") });
  });

  it("テンプレートから作られていないリポジトリには、交換も書き込みもしない", async () => {
    const gh = await fakeGitHub();
    const result = await completeManifest({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/plain", code: "c1", fetcher: gh.fetcher });
    expect(result).toEqual({ ok: false, message: SETUP_MESSAGES.notTarget });
    expect(gh.writes()).toEqual([]);
  });

  it("本人の物でないリポジトリには書き込まない", async () => {
    const gh = await fakeGitHub();
    const result = await completeManifest({ client: gh.client, login: "Gaku1205", repo: "someone/app", code: "c1", fetcher: gh.fetcher });
    expect(result.ok).toBe(false);
    expect(gh.writes()).toEqual([]);
  });

  it("交換に失敗したら、決まった文だけ", async () => {
    const gh = await fakeGitHub({ conversionStatus: 422 });
    const result = await completeManifest({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", code: "c1", fetcher: gh.fetcher });
    expect(result).toEqual({ ok: false, message: SETUP_MESSAGES.appFailed });
    expect(gh.calls.filter((call) => call.method === "PUT")).toEqual([]);
  });

  it("Secret の書き込みに失敗しても、エラーの文に鍵は入らない", async () => {
    const gh = await fakeGitHub({ secretPutStatus: 500 });
    const result = await completeManifest({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", code: "c1", fetcher: gh.fetcher });
    expect(result).toEqual({ ok: false, message: SETUP_MESSAGES.appFailed });
    expectNoSecret(result);
  });
});

describe("handleManifestReturn（state と code）", () => {
  async function setup() {
    const gh = await fakeGitHub();
    const state = newSetupState();
    const cookie = signSetupState({ state, repo: "Gaku1205/my-app", nowMs: NOW, secret: SECRET });
    const base = { cookie, state, code: "code-1", secret: SECRET, nowMs: NOW + 1000, login: "Gaku1205", client: gh.client, fetcher: gh.fetcher };
    return { gh, state, base };
  }

  it("合えば書いて、そのリポジトリの導入へ戻す", async () => {
    const { gh, base } = await setup();
    expect(await handleManifestReturn(base)).toBe("/setup?repo=Gaku1205/my-app");
    expect(gh.calls.some((call) => call.path.startsWith("/app-manifests/"))).toBe(true);
  });

  it("state が違えば何もしない（GitHub を呼ばない）", async () => {
    const { gh, base } = await setup();
    expect(await handleManifestReturn({ ...base, state: newSetupState() })).toBe("/setup?error=state");
    expect(await handleManifestReturn({ ...base, cookie: undefined })).toBe("/setup?error=state");
    expect(gh.calls).toEqual([]);
  });

  it("code が2回目なら何もしない", async () => {
    const { gh, base } = await setup();
    await handleManifestReturn(base);
    const before = gh.calls.length;
    expect(await handleManifestReturn(base)).toBe("/setup?error=state");
    expect(gh.calls.length).toBe(before);
  });

  it("ログインしていなければ書かない", async () => {
    const { gh, base } = await setup();
    expect(await handleManifestReturn({ ...base, login: null, client: null })).toBe("/setup?repo=Gaku1205/my-app&error=auth");
    expect(gh.calls).toEqual([]);
  });
});

describe("saveExistingApp（App はもう持っている）", () => {
  it("鍵で App を確かめてから書き、入っているかを返す（鍵は返さない）", async () => {
    const gh = await fakeGitHub();
    const result = await saveExistingApp({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", appId: "42", pem: PEM, fetcher: gh.fetcher, nowMs: NOW });
    expect(result).toEqual({ ok: true, installed: true });
    expectNoSecret(result);
    expect(gh.calls.some((call) => call.method === "PUT" && call.path.endsWith("/PIPELINE_APP_PRIVATE_KEY"))).toBe(true);
  });

  it("ID が合わない・鍵として読めないときは書かず、エラーの文に鍵は入らない", async () => {
    const gh = await fakeGitHub();
    const wrongId = await saveExistingApp({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", appId: "99", pem: PEM, fetcher: gh.fetcher, nowMs: NOW });
    expect(wrongId).toEqual({ ok: false, message: SETUP_MESSAGES.appKey });
    const broken = await saveExistingApp({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", appId: "42", pem: "-----BEGIN RSA PRIVATE KEY-----\nxx", fetcher: gh.fetcher, nowMs: NOW });
    expect(broken).toEqual({ ok: false, message: SETUP_MESSAGES.appKey });
    expectNoSecret([wrongId, broken]);
    expect(gh.writes()).toEqual([]);
  });

  it("テンプレートから作られていないリポジトリには書かない", async () => {
    const gh = await fakeGitHub();
    const result = await saveExistingApp({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/plain", appId: "42", pem: PEM, fetcher: gh.fetcher, nowMs: NOW });
    expect(result.ok).toBe(false);
    expect(gh.writes()).toEqual([]);
  });
});

describe("saveClaudeToken", () => {
  it("暗号にして Secret に書き、値は返さない", async () => {
    const gh = await fakeGitHub();
    const result = await saveClaudeToken({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", token: ` ${CLAUDE_TOKEN} ` });
    expect(result).toEqual({ ok: true });
    const put = gh.calls.find((call) => call.method === "PUT");
    expect(put?.path).toBe("/repos/Gaku1205/my-app/actions/secrets/CLAUDE_CODE_OAUTH_TOKEN");
    expect(put?.body).not.toContain(CLAUDE_TOKEN);
    expect(gh.open((JSON.parse(put?.body ?? "{}") as { encrypted_value: string }).encrypted_value)).toBe(CLAUDE_TOKEN);
  });

  it("本人の物でない・テンプレートから作られていないリポジトリには書かない", async () => {
    const gh = await fakeGitHub();
    for (const repo of ["someone/app", "Gaku1205/plain", "Gaku1205/missing", "bad"]) {
      const result = await saveClaudeToken({ client: gh.client, login: "Gaku1205", repo, token: CLAUDE_TOKEN });
      expect(result).toEqual({ ok: false, message: SETUP_MESSAGES.notTarget });
      expectNoSecret(result);
    }
    expect(gh.writes()).toEqual([]);
  });

  it("空のトークンは書かない", async () => {
    const gh = await fakeGitHub();
    expect(await saveClaudeToken({ client: gh.client, login: "Gaku1205", repo: "Gaku1205/my-app", token: "  " })).toEqual({
      ok: false,
      message: SETUP_MESSAGES.emptyToken,
    });
    expect(gh.calls).toEqual([]);
  });
});

describe("設定・診断・作る", () => {
  it("delete_branch_on_merge をオンにする（対象でなければ書かない）", async () => {
    const gh = await fakeGitHub();
    expect(await enableDeleteBranch(gh.client, "Gaku1205", "Gaku1205/my-app")).toEqual({ ok: true });
    expect(gh.writes()).toEqual([
      { method: "PATCH", path: "/repos/Gaku1205/my-app", body: JSON.stringify({ delete_branch_on_merge: true }) },
    ]);
    const other = await fakeGitHub();
    expect((await enableDeleteBranch(other.client, "Gaku1205", "someone/app")).ok).toBe(false);
    expect(other.writes()).toEqual([]);
  });

  it("Doctor を既定のブランチで動かす", async () => {
    const gh = await fakeGitHub();
    expect(await dispatchDoctor(gh.client, "Gaku1205", "Gaku1205/my-app")).toEqual({ ok: true });
    expect(gh.writes()).toEqual([
      {
        method: "POST",
        path: "/repos/Gaku1205/my-app/actions/workflows/doctor.yml/dispatches",
        body: JSON.stringify({ ref: "main" }),
      },
    ]);
  });

  it("テンプレートから、ログインした人のアカウントに作る", async () => {
    const gh = await fakeGitHub();
    expect(await generateSetupRepo(gh.client, "Gaku1205", "new-app", false)).toEqual({ ok: true, repo: "Gaku1205/new-app" });
    expect(gh.writes()).toEqual([
      {
        method: "POST",
        path: "/repos/Gaku1205/ai-dev-template/generate",
        body: JSON.stringify({ owner: "Gaku1205", name: "new-app", private: false, include_all_branches: false }),
      },
    ]);
  });
});

describe("loadSetupFacts", () => {
  it("名前だけを読み、値は読まない", async () => {
    const gh = await fakeGitHub();
    const { facts, notTarget } = await loadSetupFacts(gh.client, "Gaku1205", "Gaku1205/my-app", () => true);
    expect(notTarget).toBe(false);
    expect(facts).toMatchObject({
      repo: "Gaku1205/my-app",
      repoReady: true,
      hasAppId: false,
      hasAppKey: false,
      appInstalled: true,
      hasClaudeToken: true,
      deleteBranchOnMerge: false,
      doctor: null,
    });
    expect(gh.writes()).toEqual([]);
  });

  it("使えないリポジトリは notTarget", async () => {
    const gh = await fakeGitHub();
    expect((await loadSetupFacts(gh.client, "Gaku1205", "Gaku1205/plain", () => false)).notTarget).toBe(true);
    expect((await loadSetupFacts(gh.client, "Gaku1205", null, () => false)).notTarget).toBe(false);
  });
});
