import { describe, expect, it } from "vitest";
import { isAuthExpired } from "./authExpired";
import type { GitHubErrorKind, RepoResult } from "./github/types";

function failed(kind: GitHubErrorKind, readSource?: "app" | "user"): RepoResult {
  return { owner: "o", repo: "r", ok: false, error: { kind, message: "x" }, readSource };
}

describe("isAuthExpired", () => {
  it("401 が1つでもあればログアウトと判定する", () => {
    expect(isAuthExpired([failed("unauthorized")])).toBe(true);
    expect(isAuthExpired([failed("not_found"), failed("unauthorized", "user")])).toBe(true);
  });

  it("404・403・回数の上限・その他ではしない", () => {
    for (const kind of ["not_found", "forbidden", "rate_limited", "other"] as const) {
      expect(isAuthExpired([failed(kind)])).toBe(false);
    }
  });

  it("結果が空ならしない", () => {
    expect(isAuthExpired([])).toBe(false);
  });

  it("パイプラインのApp側の鍵の 401 ではしない", () => {
    expect(isAuthExpired([failed("unauthorized", "app")])).toBe(false);
  });
});
