import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoResult } from "../github/types";
import { clearSelfcheckMemoForTest, SELFCHECK_TTL_MS, selfcheckOnce, selfcheckScopeKey } from "./run";

const results: RepoResult[] = [
  { owner: "o", repo: "r", ok: true, data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], runs: [] } },
];

beforeEach(() => clearSelfcheckMemoForTest());

describe("selfcheckOnce", () => {
  it("5分のうちに2回呼んでも、読み直さない", async () => {
    const read = vi.fn(async () => results);
    const first = await selfcheckOnce("a", read, 1_000_000);
    const second = await selfcheckOnce("a", read, 1_000_000 + SELFCHECK_TTL_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("5分たったら読み直す", async () => {
    const read = vi.fn(async () => results);
    await selfcheckOnce("a", read, 1_000_000);
    await selfcheckOnce("a", read, 1_000_000 + SELFCHECK_TTL_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("同時に呼ばれたら1回にまとめる", async () => {
    const read = vi.fn(async () => results);
    await Promise.all([selfcheckOnce("a", read, 5), selfcheckOnce("a", read, 5)]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("読めなかったときは覚えず、次に読み直す", async () => {
    const read = vi.fn<() => Promise<RepoResult[]>>().mockRejectedValueOnce(new Error("x")).mockResolvedValue(results);
    await expect(selfcheckOnce("a", read, 1)).rejects.toThrow();
    await selfcheckOnce("a", read, 2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("読める範囲が違う鍵には、覚えた結果を返さない（範囲ごとに分けて覚える）", async () => {
    const read = vi.fn(async () => results);
    await selfcheckOnce("a", read, 1);
    await selfcheckOnce("b", read, 2);
    expect(read).toHaveBeenCalledTimes(2);
    await selfcheckOnce("a", read, 3);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("同時に呼ばれても、範囲が違えばまとめない", async () => {
    const read = vi.fn(async () => results);
    await Promise.all([selfcheckOnce("a", read, 5), selfcheckOnce("b", read, 5)]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("selfcheckScopeKey", () => {
  it("小文字にして並べるので、順番や大文字小文字が違っても同じ", () => {
    expect(selfcheckScopeKey(["B/x", "a/Y"])).toBe(selfcheckScopeKey(["A/y", "b/X"]));
  });
  it("読める範囲が違えば別の値", () => {
    expect(selfcheckScopeKey(["a/y"])).not.toBe(selfcheckScopeKey(["a/y", "b/x"]));
  });
});
