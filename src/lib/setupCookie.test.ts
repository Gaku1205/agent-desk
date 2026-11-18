import { beforeEach, describe, expect, it } from "vitest";
import {
  claimManifestCode,
  isManifestCode,
  newSetupState,
  signSetupState,
  STATE_TTL_MS,
  usedCodesForTest,
  verifySetupState,
} from "./setupCookie";

const SECRET = "test-secret";
const NOW = Date.parse("2026-11-18T10:00:00Z");

describe("state の署名つき Cookie", () => {
  const state = newSetupState();
  const cookie = signSetupState({ state, repo: "Gaku1205/my-app", nowMs: NOW, secret: SECRET });

  it("推測できない長さ", () => {
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(newSetupState()).not.toBe(state);
  });

  it("合えばリポジトリを返す", () => {
    expect(verifySetupState({ cookie, state, nowMs: NOW + 1000, secret: SECRET })).toBe("Gaku1205/my-app");
  });

  it("state が違えば何もしない", () => {
    expect(verifySetupState({ cookie, state: newSetupState(), nowMs: NOW, secret: SECRET })).toBeNull();
    expect(verifySetupState({ cookie, state: null, nowMs: NOW, secret: SECRET })).toBeNull();
  });

  it("Cookie が無い・書き換えた・別の鍵で署名した物は通さない", () => {
    expect(verifySetupState({ cookie: undefined, state, nowMs: NOW, secret: SECRET })).toBeNull();
    const [payload] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ s: state, r: "someone/else", t: NOW })).toString("base64url");
    expect(verifySetupState({ cookie: `${forged}.${cookie.split(".")[1]}`, state, nowMs: NOW, secret: SECRET })).toBeNull();
    expect(verifySetupState({ cookie: `${payload}.xxx`, state, nowMs: NOW, secret: SECRET })).toBeNull();
    expect(verifySetupState({ cookie, state, nowMs: NOW, secret: "other" })).toBeNull();
    expect(verifySetupState({ cookie, state, nowMs: NOW, secret: undefined })).toBeNull();
  });

  it("1時間を過ぎたら通さない", () => {
    expect(verifySetupState({ cookie, state, nowMs: NOW + STATE_TTL_MS + 1, secret: SECRET })).toBeNull();
  });
});

describe("code は1回だけ", () => {
  beforeEach(() => usedCodesForTest.clear());

  it("2回目は false", () => {
    expect(claimManifestCode("abc123", NOW)).toBe(true);
    expect(claimManifestCode("abc123", NOW)).toBe(false);
    expect(claimManifestCode("def456", NOW)).toBe(true);
  });

  it("形", () => {
    expect(isManifestCode("a1_B-2")).toBe(true);
    expect(isManifestCode("a/b")).toBe(false);
    expect(isManifestCode(null)).toBe(false);
  });
});
