"use client";

import { createContext, useContext, type ReactNode } from "react";
import styles from "./Settings.module.css";

/** 保存に成功したことを、見出しの右の `20:41 に保存しました` に知らせる */
export const SettingsSavedContext = createContext<(() => void) | null>(null);

function noop() {}

export function useMarkSaved(): () => void {
  return useContext(SettingsSavedContext) ?? noop;
}

/** 節の白い面（行を並べる1枚） */
export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className={styles.panel}>{children}</div>;
}

type RowProps = {
  /** 左の名前 */
  name: ReactNode;
  /** 名前の下の説明 */
  description?: ReactNode;
  /** 右の操作 */
  children?: ReactNode;
  /** 行の下（帯・札など、行の幅いっぱいに出す物） */
  below?: ReactNode;
  /** 失敗の理由（行の下に出す） */
  error?: string | null;
  /** 書いている間：右の操作を薄くする */
  busy?: boolean;
  /** 名前の左に置く物（アイコン） */
  icon?: ReactNode;
  /** 行の種類（CSSで行ごとに変えるとき） */
  kind?: string;
};

/** 白い面の1行：左に名前と説明、右に操作。失敗は行の下 */
export function SettingsRow({ name, description, children, below, error, busy, icon, kind }: RowProps) {
  return (
    <div className={styles.row} data-busy={busy ? "" : undefined} data-kind={kind}>
      <div className={styles.text}>
        {icon}
        <div className={styles.textBody}>
          <span className={styles.name}>{name}</span>
          {description && <span className={styles.desc}>{description}</span>}
        </div>
      </div>
      {children !== undefined && <div className={styles.control}>{children}</div>}
      {below && <div className={styles.below}>{below}</div>}
      {error && (
        <p className={styles.rowError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
