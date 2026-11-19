import { describe, expect, it } from "vitest";
import { isSelfcheckKeyAccepted, parseBearer, parseInstallationRepositories, watchedAmong } from "./auth";

const body = { repositories: [{ name: "agent-desk", owner: { login: "Acme" } }, { name: "other", owner: { login: "Acme" } }] };
const watched = [{ owner: "acme", repo: "Agent-Desk" }];

describe("parseBearer", () => {
  it("Bearer の鍵を取り出す。無い・形が違えば null", () => {
    expect(parseBearer("Bearer abc")).toBe("abc");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
  });
});

describe("parseInstallationRepositories", () => {
  it("読めたリポジトリを取り出す。形が違えば空", () => {
    expect(parseInstallationRepositories(body)).toEqual([
      { owner: "Acme", repo: "agent-desk" },
      { owner: "Acme", repo: "other" },
    ]);
    expect(parseInstallationRepositories(null)).toEqual([]);
    expect(parseInstallationRepositories({ repositories: [{ name: 1 }] })).toEqual([]);
  });
});

describe("watchedAmong", () => {
  it("大文字小文字を区別せず、読めた監視リポジトリだけ返す", () => {
    expect(watchedAmong(parseInstallationRepositories(body), watched)).toEqual(watched);
  });
});

describe("isSelfcheckKeyAccepted", () => {
  const base = { installationRepositories: body, watched, appId: "123", keyAppId: 123 };

  it("監視リポジトリが読めて、App の ID が同じときだけ受け付ける", () => {
    expect(isSelfcheckKeyAccepted(base)).toBe(true);
  });

  it("違う App の鍵は受け付けない", () => {
    expect(isSelfcheckKeyAccepted({ ...base, keyAppId: 999 })).toBe(false);
  });

  it("監視していないリポジトリの鍵は受け付けない", () => {
    expect(isSelfcheckKeyAccepted({ ...base, watched: [{ owner: "acme", repo: "unrelated" }] })).toBe(false);
    expect(isSelfcheckKeyAccepted({ ...base, installationRepositories: { repositories: [] } })).toBe(false);
  });

  it("PIPELINE_APP_ID が無い・鍵の App の ID が分からないときは受け付けない", () => {
    expect(isSelfcheckKeyAccepted({ ...base, appId: undefined })).toBe(false);
    expect(isSelfcheckKeyAccepted({ ...base, appId: "" })).toBe(false);
    expect(isSelfcheckKeyAccepted({ ...base, keyAppId: null })).toBe(false);
  });
});
