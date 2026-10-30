import { createHmac, timingSafeEqual } from "node:crypto";
import { repoChangeKey } from "./changeMarks";
import type { WatchedRepo } from "./config";

// GitHub の Webhook と「変わった」印の判定（docs/spec.md の「更新」）。
// Webhook の本文は保存しない・ログに出さない。

/** 使うイベント（`X-GitHub-Event`）。ほかは 204 で無視する */
export const WEBHOOK_EVENTS: readonly string[] = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review_comment",
  "check_run",
  "check_suite",
  "status",
  "workflow_run",
  "label",
];

/** 1回の `/api/changes` で見るリポジトリの数の上限 */
export const CHANGES_MAX_REPOS = 50;

/** そのリポジトリのキャッシュのタグ。大文字・小文字の違いで別のタグにならないよう小文字にする */
export function repoTag({ owner, repo }: WatchedRepo): string {
  return `repo:${owner}/${repo}`.toLowerCase();
}

/**
 * `X-Hub-Signature-256`（`sha256=` ＋本文の HMAC-SHA256 の16進）が合うか。
 * 比べるのは `timingSafeEqual`。署名が無い・形が違うときは false
 */
export function verifyWebhookSignature(
  body: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;
  const given = signature.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
}

/** 使うイベントか */
export function isUsedWebhookEvent(event: string | null): boolean {
  return event !== null && WEBHOOK_EVENTS.includes(event);
}

/** 本文の `repository.full_name` を `owner/repo` にする。無い・形が違うときは null */
export function webhookRepo(payload: unknown): WatchedRepo | null {
  if (typeof payload !== "object" || payload === null) return null;
  const repository = (payload as { repository?: unknown }).repository;
  if (typeof repository !== "object" || repository === null) return null;
  const fullName = (repository as { full_name?: unknown }).full_name;
  if (typeof fullName !== "string") return null;
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * 監視しているリポジトリか（大文字・小文字は区別しない）。
 * `watched` が null（設定の監視リポジトリが読めず、分からない）のときは、使う側に倒す（印を進めるだけで害は無い）
 */
export function isWatchedRepo(target: WatchedRepo, watched: WatchedRepo[] | null): boolean {
  if (watched === null) return true;
  const key = repoChangeKey(target);
  return watched.some((repo) => repoChangeKey(repo) === key);
}

/** Webhook の受け取りの結果。`invalidate` のときだけ、そのリポジトリのタグを無効にする */
export type WebhookDecision =
  | { status: 404 | 401 | 204 }
  | { status: 202; invalidate: WatchedRepo };

/**
 * Webhook をどう扱うか。環境変数が無ければ 404、署名が合わなければ 401、
 * 使わないイベント・監視していないリポジトリは 204、使う物は 202 でタグを無効にする
 */
export async function decideWebhook(input: {
  secret: string | undefined;
  signature: string | null;
  event: string | null;
  body: string;
  loadWatched: () => Promise<WatchedRepo[] | null>;
}): Promise<WebhookDecision> {
  const { secret, signature, event, body, loadWatched } = input;
  if (!secret) return { status: 404 };
  if (!verifyWebhookSignature(body, signature, secret)) return { status: 401 };
  if (!isUsedWebhookEvent(event)) return { status: 204 };
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: 204 };
  }
  const target = webhookRepo(payload);
  if (!target) return { status: 204 };
  if (!isWatchedRepo(target, await loadWatched())) return { status: 204 };
  return { status: 202, invalidate: target };
}
