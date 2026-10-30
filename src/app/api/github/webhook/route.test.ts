import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoData } from "@/lib/github/types";

// Next.js のキャッシュの代わり：キーごとに覚え、タグを無効にしたら捨てる
const store = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; tags: string[] }>(),
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keyParts: string[], options: { tags?: string[] }) =>
    async (): Promise<T> => {
      const key = keyParts.join("|");
      const known = store.entries.get(key);
      if (known) return known.value as T;
      const value = await fn();
      store.entries.set(key, { value, tags: options.tags ?? [] });
      return value;
    },
  revalidateTag: (tag: string) => {
    for (const [key, entry] of store.entries) {
      if (entry.tags.includes(tag)) store.entries.delete(key);
    }
  },
}));

const { POST } = await import("./route");
const { cachedRepoData, getChangeMark } = await import("@/lib/github/repoCache");

// 秘密はテストの中で作る（本物の値は書かない）
const SECRET = randomBytes(32).toString("hex");
const REPO = { owner: "owner", repo: "repo" };

function webhookRequest(body: string, options: { event?: string; signature?: string | null } = {}) {
  const headers = new Headers({ "x-github-event": options.event ?? "pull_request" });
  const signature =
    options.signature === undefined
      ? `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`
      : options.signature;
  if (signature !== null) headers.set("x-hub-signature-256", signature);
  return new Request("https://example.test/api/github/webhook", { method: "POST", headers, body });
}

const BODY = JSON.stringify({ action: "synchronize", repository: { full_name: "Owner/Repo" } });

function emptyData(label: string): RepoData {
  return {
    issues: [],
    pulls: [],
    comments: [],
    pullChecks: {},
    events: [],
    pipeline: { kind: "unknown" },
    mainDeployedAt: label,
    mainDeployedByContext: {},
  } as unknown as RepoData;
}

describe("POST /api/github/webhook", () => {
  beforeEach(() => {
    store.entries.clear();
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("WATCHED_REPOS", "owner/repo");
    vi.stubEnv("SETTINGS_REPO", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("正しい署名なら、そのリポジトリのタグが無効になり、次の表示で取り直される", async () => {
    let calls = 0;
    const load = async () => emptyData(`v${++calls}`);
    expect((await cachedRepoData(REPO, load)).mainDeployedAt).toBe("v1");
    expect((await cachedRepoData(REPO, load)).mainDeployedAt).toBe("v1");
    const markBefore = await getChangeMark(REPO);

    const response = await POST(webhookRequest(BODY));
    expect(response.status).toBe(202);

    await new Promise((resolve) => setTimeout(resolve, 2));
    expect((await cachedRepoData(REPO, load)).mainDeployedAt).toBe("v2");
    expect(await getChangeMark(REPO)).not.toBe(markBefore);
  });

  it("署名が違う・無いときは 401 で、キャッシュはそのまま", async () => {
    let calls = 0;
    const load = async () => emptyData(`v${++calls}`);
    await cachedRepoData(REPO, load);
    expect((await POST(webhookRequest(BODY, { signature: "sha256=00" }))).status).toBe(401);
    expect((await POST(webhookRequest(BODY, { signature: null }))).status).toBe(401);
    expect((await cachedRepoData(REPO, load)).mainDeployedAt).toBe("v1");
  });

  it("GITHUB_WEBHOOK_SECRET が無いときは 404", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    expect((await POST(webhookRequest(BODY))).status).toBe(404);
  });

  it("使わないイベント・監視していないリポジトリは 204 で、キャッシュはそのまま", async () => {
    let calls = 0;
    const load = async () => emptyData(`v${++calls}`);
    await cachedRepoData(REPO, load);
    expect((await POST(webhookRequest(BODY, { event: "push" }))).status).toBe(204);
    const other = JSON.stringify({ repository: { full_name: "owner/other" } });
    expect((await POST(webhookRequest(other))).status).toBe(204);
    expect((await cachedRepoData(REPO, load)).mainDeployedAt).toBe("v1");
  });
});
