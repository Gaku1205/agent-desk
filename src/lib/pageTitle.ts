/**
 * スマホの上のバーに出す「今のページ名」。パス（デモは `/demo` から始まる）から決める。
 * 英語にしてよい言葉は docs/design.md に書いた物だけ（Dashboard・Slots & Queue）
 */
export function pageTitle(pathname: string, basePath = ""): string {
  const path = pathname.toLowerCase().slice(basePath.length).replace(/\/+$/, "") || "/";
  if (path === "/") return "ホーム";
  if (path === "/dashboard") return "Dashboard";
  if (path === "/lanes") return "Slots & Queue";
  if (path === "/repos") return "すべてのリポジトリ";
  if (path.startsWith("/repos/")) {
    const repo = pathname.slice(basePath.length).replace(/\/+$/, "").split("/")[3];
    return repo ?? "リポジトリ";
  }
  if (path === "/settings") return "設定";
  if (path === "/new") return "Issueを書く";
  if (path.startsWith("/new/service")) return "新サービス";
  return "agent-desk";
}
