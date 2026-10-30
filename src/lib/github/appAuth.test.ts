import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAppJwt,
  chooseReadSource,
  INSTALLATION_TOKEN_MARGIN_MS,
  normalizePrivateKey,
  readAppCredentials,
  shouldReuseInstallationToken,
} from "./appAuth";

// 秘密鍵はテストの中でその場で作る
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("buildAppJwt", () => {
  const nowMs = Date.parse("2026-10-30T00:00:00Z");
  const jwt = buildAppJwt("12345", privateKey, nowMs);
  const [header, payload, signature] = jwt.split(".");

  it("RS256 で、iss は App ID、iat は少し過去、exp は10分以内", () => {
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decode(payload);
    const nowSec = nowMs / 1000;
    expect(claims.iss).toBe("12345");
    expect(claims.iat as number).toBeLessThan(nowSec);
    expect(claims.iat as number).toBeGreaterThanOrEqual(nowSec - 120);
    expect(claims.exp as number).toBeGreaterThan(nowSec);
    expect((claims.exp as number) - nowSec).toBeLessThanOrEqual(600);
  });

  it("署名が公開鍵で確かめられる", () => {
    const ok = verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
  });
});

describe("normalizePrivateKey / readAppCredentials", () => {
  it("改行が \\n の文字で入っていても読める", () => {
    const escaped = PEM.trim().replace(/\n/g, "\\n");
    expect(normalizePrivateKey(escaped)).toBe(PEM.trim());
    expect(readAppCredentials({ PIPELINE_APP_ID: "1", PIPELINE_APP_PRIVATE_KEY: escaped })).not.toBeNull();
    expect(readAppCredentials({ PIPELINE_APP_ID: "1", PIPELINE_APP_PRIVATE_KEY: `"${escaped}"` })).not.toBeNull();
  });

  it("本物の改行のPEMも読める", () => {
    expect(readAppCredentials({ PIPELINE_APP_ID: " 42 ", PIPELINE_APP_PRIVATE_KEY: PEM })?.appId).toBe("42");
  });

  it("どちらかが無い・空・PEMとして読めないときは null", () => {
    expect(readAppCredentials({})).toBeNull();
    expect(readAppCredentials({ PIPELINE_APP_ID: "1" })).toBeNull();
    expect(readAppCredentials({ PIPELINE_APP_PRIVATE_KEY: PEM })).toBeNull();
    expect(readAppCredentials({ PIPELINE_APP_ID: "", PIPELINE_APP_PRIVATE_KEY: PEM })).toBeNull();
    expect(readAppCredentials({ PIPELINE_APP_ID: "1", PIPELINE_APP_PRIVATE_KEY: "  " })).toBeNull();
    expect(readAppCredentials({ PIPELINE_APP_ID: "1", PIPELINE_APP_PRIVATE_KEY: "not a pem" })).toBeNull();
  });
});

describe("shouldReuseInstallationToken", () => {
  const now = 1_000_000;
  it("期限の5分前までは使い回す", () => {
    expect(shouldReuseInstallationToken(now + INSTALLATION_TOKEN_MARGIN_MS + 1, now)).toBe(true);
    expect(shouldReuseInstallationToken(now + 55 * 60 * 1000, now)).toBe(true);
  });

  it("期限の5分前になったら・過ぎたら・読めないときは取り直す", () => {
    expect(shouldReuseInstallationToken(now + INSTALLATION_TOKEN_MARGIN_MS, now)).toBe(false);
    expect(shouldReuseInstallationToken(now + 1000, now)).toBe(false);
    expect(shouldReuseInstallationToken(now - 1, now)).toBe(false);
    expect(shouldReuseInstallationToken(Number.NaN, now)).toBe(false);
  });
});

describe("chooseReadSource", () => {
  it("3つ揃っているときだけ App の鍵", () => {
    expect(chooseReadSource({ hasCredentials: true, hasInstallationToken: true, userCanRead: true })).toBe("app");
    expect(chooseReadSource({ hasCredentials: false, hasInstallationToken: true, userCanRead: true })).toBe("user");
    expect(chooseReadSource({ hasCredentials: true, hasInstallationToken: false, userCanRead: true })).toBe("user");
    expect(chooseReadSource({ hasCredentials: true, hasInstallationToken: true, userCanRead: false })).toBe("user");
  });
});
