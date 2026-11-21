/**
 * 画面から書くIssue（docs/spec.md の「Issueを書く」）の、入力の検証と本文の組み立て。
 * 入力から出力が決まる純粋関数だけを置く（GitHubへの送信は operations.ts）
 */

import type { RepoResult } from "./github/types";
import { parseImageUrls } from "./issueImages";

/**
 * Issueを書く欄のリポジトリ（`owner/repo` と、テンプレートリポジトリか）。
 * 取れなかったリポジトリ・取得に無いリポジトリはテンプレートでない扱い
 */
export function newIssueRepos(
  repos: { owner: string; repo: string }[],
  results: RepoResult[],
): { name: string; template: boolean }[] {
  return repos.map((watched) => {
    const found = results.find(
      (result) =>
        result.owner.toLowerCase() === watched.owner.toLowerCase() &&
        result.repo.toLowerCase() === watched.repo.toLowerCase(),
    );
    return { name: `${watched.owner}/${watched.repo}`, template: !!found && found.ok && found.data.isTemplate === true };
  });
}

/** メモ全体の長さの上限（コードポイントで数える） */
export const MAX_NEW_ISSUE_MEMO = 4000;

/** 題（メモの1行目）の長さの上限。超えたら先頭のこれだけ＋`…` */
export const MAX_NEW_ISSUE_TITLE = 120;

/** 文字数のカウンターを出し始める文字数 */
export const NEW_ISSUE_COUNTER_FROM = 3600;

/** テンプレートリポジトリで、工場が受け持つIssueの頭（全角コロン） */
export const FACTORY_TITLE_PREFIX = "新サービス：";

/** 本文に入れる「全部おまかせ」のチェック（工場が相談せずに全部決めて作る合図） */
export const OMAKASE_BODY = "- [x] 全部おまかせ";

/** `全部おまかせ` の横の補足の1行（オンのとき・オフのとき。「Issueを書く」のテンプレート選択時も同じ） */
export function omakaseHint(on: boolean): string {
  return on ? "相談なしで公開まで進めます（30分ほど）" : "案・見た目・最終確認の3回、Your turn（あなたの番）で選ぶ";
}

/** 新サービスの書き方の見本（誰が使う・何ができる・スマホか PC か・お金を取るか。押すと入力欄に入る） */
export const SERVICE_EXAMPLES: readonly string[] = [
  "一人暮らしの人が、毎朝の天気と予定を1枚で見られるスマホ向けのページ（無料）",
  "小さなお店の人が、予約を受けて一覧で確認できるPC向けの管理画面（月500円）",
  "家族で買い物リストを共有して、チェックを付けられるスマホのアプリ（無料）",
];

/**
 * 見本を入力欄に入れた結果。空（空白だけも含む）なら見本だけ。書いてあれば消さずに、
 * 末尾の改行を1つにそろえて、改行をはさんで足す
 */
export function appendExample(current: string, example: string): string {
  if (current.trim() === "") return example;
  return `${current.replace(/\n+$/, "")}\n${example}`;
}

/** 新サービスを作ったあとの、agent-desk の中の行き先（そのテンプレートリポジトリのページ。`basePath` はデモなら `/demo`） */
export function createdServiceHref(repo: string, basePath = ""): string {
  return `${basePath}/repos/${repo}`;
}

const FACTORY_PREFIX_PATTERN = /^新サービス[：:]\s*/;

export type NewIssueInput = {
  owner: string;
  repo: string;
  /** メモの全文（複数行）。頭の `新サービス：` は付けなくてよい */
  memo: string;
  /** 「全部おまかせ」を選んだか（テンプレートリポジトリのときだけ効く） */
  omakase: boolean;
  /** 本文に並べる画像のURL（先に `uploadNewIssueImage` で専用ブランチに上げたもの。形は確かめ済み） */
  imageUrls: string[];
};

export type MemoCheck = { ok: true; memo: string } | { ok: false; message: string };

export const NEW_ISSUE_MESSAGES = {
  empty: "メモを書いてください",
  tooLong: `メモは${MAX_NEW_ISSUE_MEMO.toLocaleString("en-US")}文字以内にしてください`,
} as const;

/** 文字数（コードポイント） */
export function memoLength(value: string): number {
  return [...value].length;
}

/** メモを確かめる：空（空白だけ）と、4000文字を超えるものは受け付けない。通ったら前後の空白を外す */
export function checkNewIssueMemo(value: unknown): MemoCheck {
  if (typeof value !== "string") return { ok: false, message: NEW_ISSUE_MESSAGES.empty };
  if (value.trim() === "") return { ok: false, message: NEW_ISSUE_MESSAGES.empty };
  if (memoLength(value) > MAX_NEW_ISSUE_MEMO) return { ok: false, message: NEW_ISSUE_MESSAGES.tooLong };
  return { ok: true, memo: value.trim() };
}

/** メモの最初の空でない行（前後の空白を外す）。無ければ空 */
function firstLine(memo: string): string {
  return (memo.split(/\r\n|\r|\n/).find((line) => line.trim() !== "") ?? "").trim();
}

/** 120文字を超えれば先頭120文字＋`…` */
function clipTitle(line: string): string {
  const chars = [...line];
  return chars.length > MAX_NEW_ISSUE_TITLE ? `${chars.slice(0, MAX_NEW_ISSUE_TITLE).join("")}…` : line;
}

/** メモの題：最初の空でない行。長ければ先頭120文字＋`…` */
export function memoTitle(memo: string): string {
  return clipTitle(firstLine(memo));
}

/** ブラウザから来た値を確かめる（Server Actionは誰でも直接呼べるため）。正しくなければ null */
export function parseNewIssueInput(value: unknown): NewIssueInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { owner, repo, memo, omakase, images } = value as Record<string, unknown>;
  if (typeof owner !== "string" || typeof repo !== "string") return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  if (typeof omakase !== "boolean") return null;
  const checked = checkNewIssueMemo(memo);
  if (!checked.ok) return null;
  const imageUrls = parseImageUrls(owner, repo, images);
  if (!imageUrls) return null;
  return { owner, repo, memo: checked.memo, omakase, imageUrls };
}

/**
 * Issueのタイトルと本文を組み立てる。ラベルは付けない（パイプラインの受付が企画に回す）。
 * タイトルはメモの題（最初の空でない行。120文字を超えれば先頭120文字＋`…`）、本文にはメモの全文を入れる（1行だけのときも）。
 * テンプレートリポジトリでは、タイトルの頭に `新サービス：` を付ける（すでに付いていれば重ねない）。
 * 「全部おまかせ」のときだけ、本文に `- [x] 全部おまかせ` を入れる（入れなければ工場が相談から始める）。
 * 通常のリポジトリでは「全部おまかせ」は無視する。
 * 画像があれば、`![スクショ](URL)` を1枚1行で並べる。メモ・おまかせ・画像は空行1つで分ける
 */
export function composeNewIssue(input: {
  memo: string;
  isTemplate: boolean;
  omakase: boolean;
  /** 上げた画像のURL */
  imageUrls?: string[];
}): { title: string; body: string } {
  const memo = input.memo.trim();
  const images = (input.imageUrls ?? []).map((url) => `![スクショ](${url})`).join("\n");
  const title = memoTitle(memo);
  if (!input.isTemplate) {
    return { title, body: [memo, images].filter((part) => part !== "").join("\n\n") };
  }
  const stripped = clipTitle(firstLine(memo).replace(FACTORY_PREFIX_PATTERN, "").trim());
  const parts = [memo, input.omakase ? OMAKASE_BODY : "", images].filter((part) => part !== "");
  return {
    title: `${FACTORY_TITLE_PREFIX}${stripped || title}`,
    body: parts.join("\n\n"),
  };
}
