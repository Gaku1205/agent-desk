import { createHmac, timingSafeEqual } from "node:crypto";
import { findWatchedRepo, type Env, type WatchedRepo } from "./config";

/** 画面の取り直しにつなげる GitHub Webhook のイベント（docs/spec.md の「即時反映」） */
export const WEBHOOK_EVENTS = ["issues", "pull_request", "check_run", "workflow_run"] as const;

/** 環境変数 `GITHUB_WEBHOOK_SECRET`。無い・空なら null */
export function getWebhookSecret(env: Env = process.env): string | null {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  return secret && secret.trim() !== "" ? secret : null;
}

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;

/**
 * `X-Hub-Signature-256`（`sha256=` ＋16進64文字）が、本文と秘密のHMAC-SHA256と一致するか。
 * ヘッダーが無い・形が違うときは false。比較は定数時間で行う
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null | undefined,
): boolean {
  const match = SIGNATURE_PATTERN.exec(signatureHeader?.trim() ?? "");
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  const actual = Buffer.from(match[1], "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type WebhookRoute =
  | { kind: "refresh"; repo: string }
  | { kind: "ignore"; reason: "event" | "payload" | "repo" };

function readFullName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const repository = (payload as { repository?: unknown }).repository;
  if (typeof repository !== "object" || repository === null) return null;
  const fullName = (repository as { full_name?: unknown }).full_name;
  return typeof fullName === "string" ? fullName : null;
}

/**
 * 署名を確かめたあとのWebhookを振り分ける。
 * 対象のイベントで、`repository.full_name` が監視するリポジトリなら、取り直しを伝える（`owner/repo` は設定の表記で返す）
 */
export function routeWebhook(
  event: string | null | undefined,
  payload: unknown,
  watched: WatchedRepo[],
): WebhookRoute {
  if (!WEBHOOK_EVENTS.some((name) => name === event)) return { kind: "ignore", reason: "event" };
  const fullName = readFullName(payload);
  const parts = fullName?.split("/");
  if (!parts || parts.length !== 2) return { kind: "ignore", reason: "payload" };
  const repo = findWatchedRepo(parts[0], parts[1], watched);
  if (!repo) return { kind: "ignore", reason: "repo" };
  return { kind: "refresh", repo: `${repo.owner}/${repo.repo}` };
}
