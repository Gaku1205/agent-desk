import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoData } from "./types";

// Next.js のキャッシュの代わり：キーごとに覚え、タグを無効にしたら捨てる
const store = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; tags: string[] }>(),
}));

function invalidate(tag: string) {
  for (const [key, entry] of store.entries) {
    if (entry.tags.includes(tag)) store.entries.delete(key);
  }
}

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
  revalidateTag: invalidate,
  updateTag: invalidate,
}));

const { cachedRepoData, getChangeMark, invalidateRepoNow } = await import("./repoCache");
const { repoTag } = await import("../webhook");

function data(label: string): RepoData {
  return { mainDeployedAt: label } as unknown as RepoData;
}

let counter = 0;
let repo = { owner: "owner", repo: "repo0" };
let calls = 0;
const load = async () => data(`v${++calls}`);

/** Webhook が来た（タグを無効にする） */
function webhook() {
  invalidate(repoTag(repo));
}

describe("取り直しの下限（同じリポジトリは最短15秒あける）", () => {
  beforeEach(() => {
    store.entries.clear();
    // テストごとに別のリポジトリにして、メモリに覚えた状態が混ざらないようにする
    repo = { owner: "owner", repo: `repo${++counter}` };
    calls = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("5秒おきに変わり続けても、取り直しは15秒に1回まで", async () => {
    await cachedRepoData(repo, load); // 0秒：最初の1回
    for (let second = 5; second <= 60; second += 5) {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + second * 1000);
      webhook();
      await cachedRepoData(repo, load);
    }
    // 0秒＋15・30・45・60秒の4回で、合わせて5回
    expect(calls).toBe(5);
  });

  it("15秒の間の最後の変化も、15秒たった次の取り直しで出る", async () => {
    await cachedRepoData(repo, load);
    const start = Date.now();
    vi.setSystemTime(start + 3000);
    webhook();
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v1");
    vi.setSystemTime(start + 14_000);
    webhook(); // 最後の変化
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v1");
    vi.setSystemTime(start + 15_000);
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v2");
    // まとめて1回だけ。そのあとは変わっていないので取り直さない
    vi.setSystemTime(start + 40_000);
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v2");
    expect(calls).toBe(2);
  });

  it("静かなあとの最初の変化は、すぐ取り直す", async () => {
    await cachedRepoData(repo, load);
    vi.setSystemTime(Date.now() + 10 * 60_000);
    webhook();
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v2");
  });

  it("印は、取り直してよい時になって初めて進む", async () => {
    await cachedRepoData(repo, load);
    const start = Date.now();
    const markAtFetch = await getChangeMark(repo);

    vi.setSystemTime(start + 3000);
    webhook();
    expect(await getChangeMark(repo)).toBe(markAtFetch); // 待っている間は進まない
    vi.setSystemTime(start + 10_000);
    webhook();
    expect(await getChangeMark(repo)).toBe(markAtFetch);

    vi.setSystemTime(start + 15_000);
    const markAfter = await getChangeMark(repo);
    expect(markAfter).not.toBe(markAtFetch);
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v2");
    expect(await getChangeMark(repo)).toBe(markAfter);
  });

  it("手で押す「同期」・ボタン操作の後は、下限を無視してすぐ取り直す", async () => {
    await cachedRepoData(repo, load);
    vi.setSystemTime(Date.now() + 1000);
    webhook();
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v1");
    const markBefore = await getChangeMark(repo);

    vi.setSystemTime(Date.now() + 1000);
    invalidateRepoNow(repo);
    expect(await getChangeMark(repo)).not.toBe(markBefore);
    expect((await cachedRepoData(repo, load)).mainDeployedAt).toBe("v2");
  });
});
