/** PCの左のバー（リポジトリの一覧）を畳んだか。保存の作りは motion.ts に合わせる */
export const SIDEBAR_STORAGE_KEY = "agent-desk:sidebar";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** 保存されていた値を「畳んだか」に直す。畳んだ印（`closed`）以外は、開いた状態 */
export function parseSidebarCollapsed(raw: unknown): boolean {
  return raw === "closed";
}

/** 読めない（使えない・例外）ときは、開いた状態（false） */
export function readSidebarCollapsed(storage: ReadableStorage | null | undefined): boolean {
  try {
    return parseSidebarCollapsed(storage?.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** 保存できたか。使えないときは false（画面は壊さない） */
export function writeSidebarCollapsed(
  storage: WritableStorage | null | undefined,
  collapsed: boolean,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "closed" : "open");
    return true;
  } catch {
    return false;
  }
}

/** `<html>` の `data-side` に付ける値。開いているときは付けない（null） */
export function sidebarAttribute(collapsed: boolean): "closed" | null {
  return collapsed ? "closed" : null;
}

/** 畳んだ・開いたを `<html>` に反映する */
export function applySidebar(collapsed: boolean, root: HTMLElement): void {
  const value = sidebarAttribute(collapsed);
  if (value) root.setAttribute("data-side", value);
  else root.removeAttribute("data-side");
}

/** 画面を描く前に実行して、畳んでいたのに一瞬開いて見える（ちらつく）のを避けるスクリプト */
export const SIDEBAR_INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  SIDEBAR_STORAGE_KEY,
)})==="closed")document.documentElement.setAttribute("data-side","closed")}catch(e){}`;
