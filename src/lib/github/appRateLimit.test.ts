import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAppRateLimitForTest, getAppRateLimit, parseAppRateLimit } from "./appToken";

describe("parseAppRateLimit", () => {
  it("resources.core の残り・上限・回復の時刻を読む", () => {
    expect(parseAppRateLimit({ resources: { core: { limit: 5000, remaining: 3912, reset: 1760000000 } } })).toEqual({
      remaining: 3912,
      resetAt: 1760000000,
      limit: 5000,
    });
  });

  it("形が違えば不明（作り物の数字を出さない）", () => {
    expect(parseAppRateLimit(null)).toEqual({ remaining: null, resetAt: null, limit: null });
    expect(parseAppRateLimit({ resources: { core: { remaining: "x" } } }).remaining).toBeNull();
  });
});

describe("getAppRateLimit", () => {
  beforeEach(() => clearAppRateLimitForTest());

  it("リポジトリが無い・App の環境変数が無いときは GitHub を呼ばず不明", async () => {
    const fetcher = vi.fn();
    expect(await getAppRateLimit(undefined, { env: {}, fetcher: fetcher as unknown as typeof fetch })).toEqual({
      remaining: null,
      resetAt: null,
      limit: null,
    });
    expect(
      await getAppRateLimit({ owner: "o", repo: "r" }, { env: {}, fetcher: fetcher as unknown as typeof fetch, nowMs: 99_999_999 }),
    ).toEqual({ remaining: null, resetAt: null, limit: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("5分の間は覚えた値を返す", async () => {
    const fetcher = vi.fn();
    const options = { env: {}, fetcher: fetcher as unknown as typeof fetch };
    await getAppRateLimit(undefined, { ...options, nowMs: 1_000 });
    await getAppRateLimit(undefined, { ...options, nowMs: 1_000 + 4 * 60_000 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
