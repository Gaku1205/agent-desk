import { describe, expect, it, vi } from "vitest";
import { UNPACK_MEMO_LIMIT, unpackMemoized, type UnpackMemo } from "./unpackMemo";

const parse = (packed: string) => ({ v: packed });

describe("unpackMemoized", () => {
  it("同じキー・同じ中身なら、展開し直さず同じ物を返す", () => {
    const memo: UnpackMemo<{ v: string }> = new Map();
    const unpack = vi.fn(parse);
    const first = unpackMemoized(memo, "a", "x", unpack);
    const second = unpackMemoized(memo, "a", "x", unpack);
    expect(second).toBe(first);
    expect(unpack).toHaveBeenCalledTimes(1);
  });

  it("同じキーでも中身が違えば展開し直す", () => {
    const memo: UnpackMemo<{ v: string }> = new Map();
    const unpack = vi.fn(parse);
    unpackMemoized(memo, "a", "x", unpack);
    expect(unpackMemoized(memo, "a", "y", unpack).v).toBe("y");
    expect(unpack).toHaveBeenCalledTimes(2);
  });

  it("変わったリポジトリ1つだけ展開する（15個のうち1つ）", () => {
    const memo: UnpackMemo<{ v: string }> = new Map();
    const unpack = vi.fn(parse);
    for (let i = 0; i < 15; i++) unpackMemoized(memo, `r${i}`, "old", unpack);
    unpack.mockClear();
    for (let i = 0; i < 15; i++) unpackMemoized(memo, `r${i}`, i === 3 ? "new" : "old", unpack);
    expect(unpack).toHaveBeenCalledTimes(1);
  });

  it("上限を超えたら古い物から捨てる", () => {
    const memo: UnpackMemo<{ v: string }> = new Map();
    for (let i = 0; i < UNPACK_MEMO_LIMIT + 5; i++) unpackMemoized(memo, `k${i}`, "x", parse);
    expect(memo.size).toBe(UNPACK_MEMO_LIMIT);
    expect(memo.has("k0")).toBe(false);
    expect(memo.has(`k${UNPACK_MEMO_LIMIT + 4}`)).toBe(true);
  });
});
