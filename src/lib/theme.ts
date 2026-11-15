/** 「テーマ」の設定。OSに合わせる／白／黒 */
export type ThemeSetting = "system" | "light" | "dark";

/** 実際に使うテーマ */
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "agent-desk:theme";

export const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: "system", label: "OSに合わせる" },
  { value: "light", label: "白" },
  { value: "dark", label: "黒" },
];

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** 保存されていた値を設定に直す。不正な値は「OSに合わせる」 */
export function parseTheme(raw: unknown): ThemeSetting {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** 設定と OS の設定（黒が好みか）から、実際のテーマを決める */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): Theme {
  if (setting === "light") return "light";
  if (setting === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

/** `<html>` の `data-theme` に付ける値。OSに合わせる場合は付けない（null） */
export function themeAttribute(setting: ThemeSetting): Theme | null {
  return setting === "system" ? null : setting;
}

/** 読めない（使えない・例外）ときは「OSに合わせる」 */
export function readTheme(storage: ReadableStorage | null | undefined): ThemeSetting {
  try {
    return parseTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** 保存できたか。使えないときは false（画面は壊さない） */
export function writeTheme(
  storage: WritableStorage | null | undefined,
  setting: ThemeSetting,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(THEME_STORAGE_KEY, setting);
    return true;
  } catch {
    return false;
  }
}

/** 設定を `<html>` に反映する */
export function applyTheme(setting: ThemeSetting, root: HTMLElement): void {
  const value = themeAttribute(setting);
  if (value) root.setAttribute("data-theme", value);
  else root.removeAttribute("data-theme");
}

/** 画面を描く前に実行して、最初に別のテーマが一瞬見えるのを避けるスクリプト */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
