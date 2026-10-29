/**
 * 外のサイトへのURLか（`http://`・`https://` で始まる）。
 * アプリの中のページ（`/demo/repos/…` のように `/` で始まる）は false で、同じタブで開く（docs/design.md の「方針」）
 */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
