/**
 * 画面から書くIssue（docs/spec.md の「Issueを書く」）の、入力の検証と本文の組み立て。
 * 入力から出力が決まる純粋関数だけを置く（GitHubへの送信は operations.ts）
 */

/** メモ（タイトル）の長さの上限 */
export const MAX_NEW_ISSUE_TITLE = 120;

/** テンプレートリポジトリで、工場が受け持つIssueの頭（全角コロン） */
export const FACTORY_TITLE_PREFIX = "新サービス：";

/** 本文に入れる「全部おまかせ」のチェック（工場が相談せずに全部決めて作る合図） */
export const OMAKASE_BODY = "- [x] 全部おまかせ";

const FACTORY_PREFIX_PATTERN = /^新サービス[：:]\s*/;

export type NewIssueInput = {
  owner: string;
  repo: string;
  /** メモ（1行のタイトル）。頭の `新サービス：` は付けなくてよい */
  title: string;
  /** 「全部おまかせ」を選んだか（テンプレートリポジトリのときだけ効く） */
  omakase: boolean;
};

export type TitleCheck = { ok: true; title: string } | { ok: false; message: string };

export const NEW_ISSUE_MESSAGES = {
  empty: "メモを書いてください",
  tooLong: `メモは${MAX_NEW_ISSUE_TITLE}文字以内にしてください`,
  multiline: "メモは1行で書いてください",
} as const;

/** メモを確かめる：前後の空白を外し、空・改行あり・長すぎるものは受け付けない */
export function checkNewIssueTitle(value: unknown): TitleCheck {
  if (typeof value !== "string") return { ok: false, message: NEW_ISSUE_MESSAGES.empty };
  const title = value.trim();
  if (title === "") return { ok: false, message: NEW_ISSUE_MESSAGES.empty };
  if (/[\r\n]/.test(title)) return { ok: false, message: NEW_ISSUE_MESSAGES.multiline };
  if ([...title].length > MAX_NEW_ISSUE_TITLE) return { ok: false, message: NEW_ISSUE_MESSAGES.tooLong };
  return { ok: true, title };
}

/** ブラウザから来た値を確かめる（Server Actionは誰でも直接呼べるため）。正しくなければ null */
export function parseNewIssueInput(value: unknown): NewIssueInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { owner, repo, title, omakase } = value as Record<string, unknown>;
  if (typeof owner !== "string" || typeof repo !== "string") return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  if (typeof omakase !== "boolean") return null;
  const checked = checkNewIssueTitle(title);
  if (!checked.ok) return null;
  return { owner, repo, title: checked.title, omakase };
}

/**
 * Issueのタイトルと本文を組み立てる。ラベルは付けない（パイプラインの受付が企画に回す）。
 * テンプレートリポジトリでは、タイトルを `新サービス：` 付きにする（すでに付いていれば重ねない）。
 * 「全部おまかせ」のときだけ、本文に `- [x] 全部おまかせ` を入れる（入れなければ工場が相談から始める）。
 * 通常のリポジトリでは「全部おまかせ」は無視する
 */
export function composeNewIssue(input: {
  title: string;
  isTemplate: boolean;
  omakase: boolean;
}): { title: string; body: string } {
  if (!input.isTemplate) return { title: input.title, body: "" };
  const memo = input.title.replace(FACTORY_PREFIX_PATTERN, "").trim();
  return {
    title: `${FACTORY_TITLE_PREFIX}${memo || input.title}`,
    body: input.omakase ? OMAKASE_BODY : "",
  };
}
