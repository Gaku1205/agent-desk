import { describe, expect, it } from "vitest";
import { ACCESS_DENIED_MESSAGE, AUTH_ERROR_MESSAGE, getAuthErrorMessage } from "./authError";

describe("getAuthErrorMessage", () => {
  it("AccessDenied は、オーナー専用の文言", () => {
    expect(getAuthErrorMessage("AccessDenied")).toBe(ACCESS_DENIED_MESSAGE);
  });

  it("配列のときは最初の値で決める", () => {
    expect(getAuthErrorMessage(["AccessDenied", "Configuration"])).toBe(ACCESS_DENIED_MESSAGE);
  });

  it("それ以外・無いときは、もう一度の文言（値は出さない）", () => {
    expect(getAuthErrorMessage("Configuration")).toBe(AUTH_ERROR_MESSAGE);
    expect(getAuthErrorMessage("secret-token-xyz")).toBe(AUTH_ERROR_MESSAGE);
    expect(getAuthErrorMessage(undefined)).toBe(AUTH_ERROR_MESSAGE);
    expect(getAuthErrorMessage([])).toBe(AUTH_ERROR_MESSAGE);
  });
});
