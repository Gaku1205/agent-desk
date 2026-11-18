/**
 * Issueを書く欄の「リポジトリの選び」と、`Issueを書く`（/new）へのリンク（docs/spec.md の「Issueを書く」）。
 * 入力から出力が決まる純粋関数だけを置く
 */

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * 入力欄で選ぶリポジトリ名。
 * 手で選んだ物（`manual`）は、選んだときのページ（`manualPage`）にいる間だけ守る。ページが替わったら捨てて、
 * 今のページのリポジトリ（`pageRepo`）に従う。選べない名前（監視していない）・ページのリポジトリが無いときは先頭
 */
export function chooseIssueRepo(input: {
  /** 選べるリポジトリ名（`owner/repo`。監視リポジトリの並び） */
  names: string[];
  /** 今のページのリポジトリ（リポジトリのページ以外は無し） */
  pageRepo?: string | null;
  /** 手で選んだ物（無ければ無し） */
  manual?: string | null;
  /** 手で選んだときのページのリポジトリ（そのときリポジトリのページでなければ無し） */
  manualPage?: string | null;
}): string {
  const { names } = input;
  const find = (name: string | null | undefined) => (name ? names.find((n) => sameName(n, name)) : undefined);
  const page = input.pageRepo ?? null;
  const manualPage = input.manualPage ?? null;
  const samePage = page === manualPage || (page !== null && manualPage !== null && sameName(page, manualPage));
  if (samePage) {
    const manual = find(input.manual);
    if (manual) return manual;
  }
  return find(page) ?? names[0] ?? "";
}

/**
 * `Issueを書く` のリンク。リポジトリのページから開くときは `?repo=owner/repo` を付け、そのリポジトリを選んで開く。
 * それ以外（ホームなど）は付けない。`basePath` はデモなら `/demo`
 */
export function newIssueHref(basePath: string, repo: { owner: string; repo: string } | null): string {
  const base = `${basePath}/new`;
  if (!repo) return base;
  return `${base}?repo=${encodeURIComponent(`${repo.owner}/${repo.repo}`).replace(/%2F/gi, "/")}`;
}
