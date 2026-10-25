import type { GitHubErrorKind } from "./types";

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

  constructor(kind: GitHubErrorKind, status: number | null = null) {
    super(MESSAGES[kind]);
    this.name = "GitHubError";
    this.kind = kind;
    this.status = status;
  }
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
