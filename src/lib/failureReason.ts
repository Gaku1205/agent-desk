export type FailureReason = {
  /** 原因とログを除いた説明 */
  text: string;
  /** 原因の分類（無ければ null） */
  cause: string | null;
  /** その実行のログのURL（無い・別のリポジトリ・別のサイトなら null） */
  logUrl: string | null;
};

const CAUSE_OPEN = "（原因：";
const LOG_SEPARATOR = "。ログ：";
const LOG_URL_PATTERN = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/actions\/runs\/\d+$/;

/**
 * パイプラインが書く止まった理由（`{説明}（原因：{原因}。ログ：{URL}）`）から、説明・原因・ログのURLを取り出す。
 * 原因の中に `（）` が入れ子で入るので、末尾から見て `。ログ：` の位置で分ける。
 * URL は `repo`（`owner/repo`・大文字小文字は区別しない）のActionsの実行のページのときだけ採る。
 * 形が合わなければ、元の文をそのまま説明にする
 */
export function parseFailureReason(reason: string, repo: string): FailureReason {
  const plain: FailureReason = { text: reason, cause: null, logUrl: null };
  const trimmed = reason.trimEnd();
  if (!trimmed.endsWith("）")) return plain;
  const body = trimmed.slice(0, -1);

  const separator = body.lastIndexOf(LOG_SEPARATOR);
  if (separator < 0) return plain;
  const open = body.lastIndexOf(CAUSE_OPEN, separator);
  if (open < 0) return plain;

  const cause = body.slice(open + CAUSE_OPEN.length, separator).trim();
  const url = body.slice(separator + LOG_SEPARATOR.length).trim();
  const text = body.slice(0, open);
  if (cause === "" || text.trim() === "") return plain;

  return { text, cause, logUrl: isRunUrlOf(url, repo) ? url : null };
}

function isRunUrlOf(url: string, repo: string): boolean {
  const match = LOG_URL_PATTERN.exec(url);
  if (!match) return false;
  return `${match[1]}/${match[2]}`.toLowerCase() === repo.toLowerCase();
}

/** 画面に出す文：`{説明}（{原因}）`。原因が無ければ説明だけ */
export function failureReasonText(parsed: FailureReason): string {
  return parsed.cause === null ? parsed.text : `${parsed.text}（${parsed.cause}）`;
}
