import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getWebhookSecret, routeWebhook, verifyWebhookSignature } from "./webhook";

const secret = "test-secret";
const body = JSON.stringify({ action: "labeled", repository: { full_name: "Gaku1205/agent-desk" } });
const sign = (key: string, text: string) =>
  `sha256=${createHmac("sha256", key).update(text, "utf8").digest("hex")}`;

describe("getWebhookSecret", () => {
  it("設定されていれば返す", () => {
    expect(getWebhookSecret({ GITHUB_WEBHOOK_SECRET: "abc" })).toBe("abc");
  });

  it("無い・空・空白だけなら null", () => {
    expect(getWebhookSecret({})).toBeNull();
    expect(getWebhookSecret({ GITHUB_WEBHOOK_SECRET: "" })).toBeNull();
    expect(getWebhookSecret({ GITHUB_WEBHOOK_SECRET: "  " })).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  it("本文と秘密のHMAC-SHA256が一致すれば true", () => {
    expect(verifyWebhookSignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("16進の大文字でも受け付ける", () => {
    const upper = `sha256=${sign(secret, body).slice(7).toUpperCase()}`;
    expect(verifyWebhookSignature(secret, body, upper)).toBe(true);
  });

  it("秘密が違えば false", () => {
    expect(verifyWebhookSignature(secret, body, sign("other", body))).toBe(false);
  });

  it("本文が1文字でも違えば false", () => {
    expect(verifyWebhookSignature(secret, `${body} `, sign(secret, body))).toBe(false);
  });

  it("ヘッダーが無い・形が違うときは false", () => {
    expect(verifyWebhookSignature(secret, body, null)).toBe(false);
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(secret, body, "")).toBe(false);
    expect(verifyWebhookSignature(secret, body, sign(secret, body).slice(7))).toBe(false);
    expect(verifyWebhookSignature(secret, body, sign(secret, body).replace("sha256", "sha1"))).toBe(false);
    expect(verifyWebhookSignature(secret, body, sign(secret, body).slice(0, -2))).toBe(false);
    expect(verifyWebhookSignature(secret, body, `sha256=${"z".repeat(64)}`)).toBe(false);
  });
});

describe("routeWebhook", () => {
  const watched = [
    { owner: "Gaku1205", repo: "agent-desk" },
    { owner: "Gaku1205", repo: "todo" },
  ];
  const payload = (fullName: unknown) => ({ repository: { full_name: fullName } });

  it.each(["issues", "pull_request", "check_run", "workflow_run"])(
    "%s は監視するリポジトリなら取り直しを伝える",
    (event) => {
      expect(routeWebhook(event, payload("Gaku1205/agent-desk"), watched)).toEqual({
        kind: "refresh",
        repo: "Gaku1205/agent-desk",
      });
    },
  );

  it("リポジトリ名の大文字小文字は区別せず、設定の表記で返す", () => {
    expect(routeWebhook("issues", payload("gaku1205/TODO"), watched)).toEqual({
      kind: "refresh",
      repo: "Gaku1205/todo",
    });
  });

  it("対象外のイベント（ping など）は無視する", () => {
    expect(routeWebhook("ping", payload("Gaku1205/agent-desk"), watched)).toEqual({
      kind: "ignore",
      reason: "event",
    });
    expect(routeWebhook(null, payload("Gaku1205/agent-desk"), watched).kind).toBe("ignore");
  });

  it("監視していないリポジトリは無視する", () => {
    expect(routeWebhook("issues", payload("someone/else"), watched)).toEqual({
      kind: "ignore",
      reason: "repo",
    });
    expect(routeWebhook("issues", payload("Gaku1205/agent-desk"), [])).toEqual({
      kind: "ignore",
      reason: "repo",
    });
  });

  it("本文にリポジトリが無い・形が違うときは無視する", () => {
    expect(routeWebhook("issues", {}, watched)).toEqual({ kind: "ignore", reason: "payload" });
    expect(routeWebhook("issues", null, watched)).toEqual({ kind: "ignore", reason: "payload" });
    expect(routeWebhook("issues", payload(42), watched)).toEqual({ kind: "ignore", reason: "payload" });
    expect(routeWebhook("issues", payload("a/b/c"), watched)).toEqual({
      kind: "ignore",
      reason: "payload",
    });
  });
});
