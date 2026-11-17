import { describe, expect, it } from "vitest";
import { confirmTokenExpired, isAuthExpired } from "./authExpired";
import type { GitHubErrorKind, RepoResult } from "./github/types";

function failed(kind: GitHubErrorKind, readSource?: "app" | "user"): RepoResult {
  return { owner: "o", repo: "r", ok: false, error: { kind, message: "x" }, readSource };
}

describe("confirmTokenExpired", () => {
  const respond = (status: number): typeof fetch => async () => new Response(null, { status });

  it("401 のときだけ true", async () => {
    expect(await confirmTokenExpired("t", respond(401))).toBe(true);
  });

  it("成功・403・回数の上限・500 では false", async () => {
    for (const status of [200, 403, 429, 500]) {
      expect(await confirmTokenExpired("t", respond(status))).toBe(false);
    }
  });

  it("通信に失敗したら false", async () => {
    const failing: typeof fetch = async () => {
      throw new Error("network");
    };
    expect(await confirmTokenExpired("t", failing)).toBe(false);
  });

  it("トークンが無ければ GitHub を呼ばずに false", async () => {
    let called = false;
    const spy: typeof fetch = async () => {
      called = true;
      return new Response(null, { status: 401 });
    };
    expect(await confirmTokenExpired(null, spy)).toBe(false);
    expect(called).toBe(false);
  });

  it("トークンは Authorization ヘッダーで送り、URL には出さない", async () => {
    let url = "";
    let auth = "";
    const spy: typeof fetch = async (input, init) => {
      url = String(input);
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(null, { status: 200 });
    };
    await confirmTokenExpired("secret", spy);
    expect(url).not.toContain("secret");
    expect(auth).toBe("Bearer secret");
  });
});

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
