import { createHmac, timingSafeEqual } from "node:crypto";
import { repoChangeKey } from "./changeMarks";
import type { WatchedRepo } from "./config";

// GitHub の Webhook と「変わった」印の判定（docs/spec.md の「更新」）。
// Webhook の本文は保存しない・ログに出さない。

/**
 * 使うイベント（`X-GitHub-Event`）。ほかは 204 で無視する。
 * `check_suite` は使わない（画面のデータは変わらない。チェックの変化は `check_run`、実行の変化は `workflow_run` で来る）
 */
export const WEBHOOK_EVENTS: readonly string[] = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review_comment",
  "check_run",
  "status",
  "workflow_run",
  "label",
];

/**
 * 画面のデータが変わらない知らせか（取り直さない。GraphQL の回数制限の枠を使わないため）。
 * `workflow_run` のうち、実行が作られただけ（`requested`）と、何もせず飛ばされた実行の完了（`conclusion` が `skipped`）。
 * パイプラインは、コメントやほかの実行の完了のたびに「条件に合わないので飛ばす」実行を何本も作る（全体の3〜5割）。
 * 動き出し（`in_progress`）と、飛ばされていない完了は使う
 */
export function isNoChangeWebhook(event: string | null, payload: unknown): boolean {
  if (event !== "workflow_run") return false;
  if (typeof payload !== "object" || payload === null) return false;
  const { action, workflow_run: run } = payload as { action?: unknown; workflow_run?: unknown };
  if (action === "requested") return true;
  const conclusion =
    typeof run === "object" && run !== null ? (run as { conclusion?: unknown }).conclusion : undefined;
  return action === "completed" && conclusion === "skipped";
}

/** 本文の中の入れ物（`check_run` など）を読む。形が違えば null */
function payloadPart(payload: unknown, key: string): Record<string, unknown> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const part = (payload as Record<string, unknown>)[key];
  return typeof part === "object" && part !== null ? (part as Record<string, unknown>) : null;
}

/** 急ぎにする `pull_request` の `action`（PR ができた・閉じた・ラベルが変わったなど。コミットの追加や題名の書き換えは入れない） */
const URGENT_PULL_ACTIONS: readonly string[] = [
  "opened",
  "closed",
  "reopened",
  "labeled",
  "unlabeled",
  "ready_for_review",
  "converted_to_draft",
];

/**
 * 急ぎの知らせか（段階・誰の番が変わりうる物。取り直しの持ち分が1回分あれば、すぐ取り直す。`src/lib/refetchLimit.ts`）。
 * - `issues`：題名・本文の書き換え（`edited`）以外（できた・閉じた・ラベルの付け外しなど）
 * - `pull_request`：できた・閉じた（マージ）・開き直した・ラベルの付け外し・下書きの切り替え
 * - `issue_comment`：新しいコメント（`created`。質問・答え・進捗の記録）。書き換え・削除は急ぎでない（作業中のコメントは何度も書き換わる）
 * - `check_run`：PR のチェックが終わった（`completed` で、`pull_requests` があり、結果が `skipped`・`neutral` でない）
 * - `status`：公開などのステータスが決まった（`state` が `pending` でない）
 * ほか（`workflow_run`・`label`・`pull_request_review_comment`、形が読めない本文）は急ぎでない（今までどおりの間隔で取り直す）
 */
export function isUrgentWebhook(event: string | null, payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const { action, state } = payload as { action?: unknown; state?: unknown };
  switch (event) {
    case "issues":
      return typeof action === "string" && action !== "edited";
    case "pull_request":
      return typeof action === "string" && URGENT_PULL_ACTIONS.includes(action);
    case "issue_comment":
      return action === "created";
    case "check_run": {
      const run = payloadPart(payload, "check_run");
      if (action !== "completed" || !run) return false;
      if (run.conclusion === "skipped" || run.conclusion === "neutral") return false;
      return Array.isArray(run.pull_requests) && run.pull_requests.length > 0;
    }
    case "status":
      return typeof state === "string" && state !== "pending";
    default:
      return false;
  }
}

/** 1回の `/api/changes` で見るリポジトリの数の上限 */
export const CHANGES_MAX_REPOS = 50;

/** そのリポジトリのキャッシュのタグ。大文字・小文字の違いで別のタグにならないよう小文字にする */
export function repoTag({ owner, repo }: WatchedRepo): string {
  return `repo:${owner}/${repo}`.toLowerCase();
}

/** 急ぎの知らせのタグ。急ぎの知らせが来たときだけ無効にする（`repo:` のタグと一緒に） */
export function urgentTag({ owner, repo }: WatchedRepo): string {
  return `urgent:${owner}/${repo}`.toLowerCase();
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

/**
 * Webhook の受け取りの結果。`invalidate` のときだけ、そのリポジトリのタグを無効にする。
 * `urgent` が true なら、急ぎの知らせのタグ（`urgentTag`）も無効にする
 */
export type WebhookDecision =
  | { status: 404 | 401 | 204 }
  | { status: 202; invalidate: WatchedRepo; urgent: boolean };

/**
 * Webhook をどう扱うか。環境変数が無ければ 404、署名が合わなければ 401、
 * 使わないイベント・画面のデータが変わらない知らせ・監視していないリポジトリは 204、使う物は 202 でタグを無効にする
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
  if (isNoChangeWebhook(event, payload)) return { status: 204 };
  const target = webhookRepo(payload);
  if (!target) return { status: 204 };
  if (!isWatchedRepo(target, await loadWatched())) return { status: 204 };
  return { status: 202, invalidate: target, urgent: isUrgentWebhook(event, payload) };
}
