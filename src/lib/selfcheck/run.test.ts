import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoResult } from "../github/types";
import { clearSelfcheckMemoForTest, SELFCHECK_TTL_MS, selfcheckOnce } from "./run";

const results: RepoResult[] = [
  { owner: "o", repo: "r", ok: true, data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], runs: [] } },
];

beforeEach(() => clearSelfcheckMemoForTest());

describe("selfcheckOnce", () => {
  it("5分のうちに2回呼んでも、読み直さない", async () => {
    const read = vi.fn(async () => results);
    const first = await selfcheckOnce(read, 1_000_000);
    const second = await selfcheckOnce(read, 1_000_000 + SELFCHECK_TTL_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("5分たったら読み直す", async () => {
    const read = vi.fn(async () => results);
    await selfcheckOnce(read, 1_000_000);
    await selfcheckOnce(read, 1_000_000 + SELFCHECK_TTL_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("同時に呼ばれたら1回にまとめる", async () => {
    const read = vi.fn(async () => results);
    await Promise.all([selfcheckOnce(read, 5), selfcheckOnce(read, 5)]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("読めなかったときは覚えず、次に読み直す", async () => {
    const read = vi.fn<() => Promise<RepoResult[]>>().mockRejectedValueOnce(new Error("x")).mockResolvedValue(results);
    await expect(selfcheckOnce(read, 1)).rejects.toThrow();
    await selfcheckOnce(read, 2);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
