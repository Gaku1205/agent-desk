import { formatResetTime } from "../refresh";
import type { GitHubErrorKind } from "./types";

/** どの鍵で読んでいたか。app のレート制限だけ、文言に「（パイプラインのApp）」を付ける */
export type ErrorSource = "user" | "app";

const MESSAGES: Record<GitHubErrorKind, string> = {
  unauthorized: "GitHubの認証が切れています。ログインし直してください",
  forbidden: "このリポジトリを読む権限がありません",
  not_found: "リポジトリが見つかりません",
  rate_limited: "GitHubのレート制限に達しました。しばらくしてからもう一度試してください",
  other: "GitHubからデータを取れませんでした",
};

/** GitHubのAPIのエラー。メッセージは日本語の固定文だけで、トークンやレスポンスの中身は含めない */
export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status: number | null;
  /** 返事の `X-RateLimit-Reset`（回復する時刻。UNIX秒）。無ければ null */
  readonly rateLimitResetAt: number | null;

  constructor(
    kind: GitHubErrorKind,
    status: number | null = null,
    rateLimitResetAt: number | null = null,
    source: ErrorSource = "user",
  ) {
    super(buildMessage(kind, rateLimitResetAt, source));
    this.name = "GitHubError";
    this.kind = kind;
    this.status = status;
    this.rateLimitResetAt = rateLimitResetAt;
  }
}

/** レート制限で、回復する時刻が分かるときは日本時間 `HH:MM` を入れる */
function buildMessage(kind: GitHubErrorKind, resetAt: number | null, source: ErrorSource): string {
  if (kind === "rate_limited") {
    const subject = source === "app" ? "GitHubのレート制限（パイプラインのApp）" : "GitHubのレート制限";
    return resetAt !== null
      ? `${subject}に達しました。${formatResetTime(resetAt)}（日本時間）ごろに回復します`
      : `${subject}に達しました。しばらくしてからもう一度試してください`;
  }
  return MESSAGES[kind];
}

/** 失敗したレスポンスのステータスとヘッダーから、エラーの種類を決める */
export function classifyError(status: number, headers: Headers): GitHubErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 403) {
    const limited =
      headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after");
    return limited ? "rate_limited" : "forbidden";
  }
  if (status === 404) return "not_found";
  return "other";
}

/** 何が投げられても、画面に出せる { kind, message } にする */
export function toErrorInfo(error: unknown): { kind: GitHubErrorKind; message: string } {
  if (error instanceof GitHubError) return { kind: error.kind, message: error.message };
  return { kind: "other", message: MESSAGES.other };
}
