import { describe, expect, it } from "vitest";
import { isAllowedLogin } from "./allowlist";

describe("isAllowedLogin", () => {
  const allowed = ["gaku1205"];

  it("許可リストにあれば true", () => {
    expect(isAllowedLogin("gaku1205", allowed)).toBe(true);
  });

  it("大文字小文字は区別しない", () => {
    expect(isAllowedLogin("Gaku1205", allowed)).toBe(true);
    expect(isAllowedLogin("gaku1205", ["GAKU1205"])).toBe(true);
  });

  it("許可リストに無ければ false", () => {
    expect(isAllowedLogin("octocat", allowed)).toBe(false);
  });

  it("ユーザー名が無ければ false", () => {
    expect(isAllowedLogin(undefined, allowed)).toBe(false);
    expect(isAllowedLogin(null, allowed)).toBe(false);
    expect(isAllowedLogin("", allowed)).toBe(false);
    expect(isAllowedLogin("  ", allowed)).toBe(false);
  });

  it("許可リストが空なら誰も入れない", () => {
    expect(isAllowedLogin("gaku1205", [])).toBe(false);
  });
});
