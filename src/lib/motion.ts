/** 「アニメーション」の設定。端末の設定に従う／オン／オフ */
export type MotionSetting = "system" | "on" | "off";

export const MOTION_STORAGE_KEY = "agent-desk:motion";

export const MOTION_OPTIONS: { value: MotionSetting; label: string }[] = [
  { value: "system", label: "端末の設定に従う" },
  { value: "on", label: "オン" },
  { value: "off", label: "オフ" },
];

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** 保存されていた値を設定に直す。不正な値は「端末の設定に従う」 */
export function parseMotion(raw: unknown): MotionSetting {
  return raw === "on" || raw === "off" ? raw : "system";
}

/** `<html>` の `data-motion` に付ける値。従う場合は付けない（null） */
export function motionAttribute(setting: MotionSetting): "full" | "reduce" | null {
  if (setting === "on") return "full";
  if (setting === "off") return "reduce";
  return null;
}

/** 読めない（使えない・例外）ときは「端末の設定に従う」 */
export function readMotion(storage: ReadableStorage | null | undefined): MotionSetting {
  try {
    return parseMotion(storage?.getItem(MOTION_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** 保存できたか。使えないときは false（画面は壊さない） */
export function writeMotion(
  storage: WritableStorage | null | undefined,
  setting: MotionSetting,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(MOTION_STORAGE_KEY, setting);
    return true;
  } catch {
    return false;
  }
}

/** ブラウザの localStorage。使えなければ null */
export function getBrowserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 設定を `<html>` に反映する */
export function applyMotion(setting: MotionSetting, root: HTMLElement): void {
  const value = motionAttribute(setting);
  if (value) root.setAttribute("data-motion", value);
  else root.removeAttribute("data-motion");
}

/** 画面を描く前に実行して、最初に一瞬動く・ちらつくのを避けるスクリプト */
export const MOTION_INIT_SCRIPT = `try{var m=localStorage.getItem(${JSON.stringify(
  MOTION_STORAGE_KEY,
)});if(m==="on")document.documentElement.setAttribute("data-motion","full");else if(m==="off")document.documentElement.setAttribute("data-motion","reduce")}catch(e){}`;

/**
 * 映像（canvas）や JS の動きを止めるか。端末の設定（`prefers-reduced-motion`）と `<html>` の `data-motion` の両方を見る。
 * CSS の判定（globals.css）と同じ：オフなら止める、オンなら端末の設定にかかわらず動かす、従うなら端末の設定どおり
 */
export function isMotionReduced(systemReduced: boolean, attribute: string | null): boolean {
  if (attribute === "reduce") return true;
  if (attribute === "full") return false;
  return systemReduced;
}
