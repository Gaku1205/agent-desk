"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SaveFailureLine } from "@/lib/saveFailures";
import styles from "./Settings.module.css";

export type SettingsSavedValue = {
  /** 保存に成功したことを、見出しの右の `20:41 に保存しました` に知らせる */
  markSaved: () => void;
  /** 行（`parallel:day` など）の保存の失敗が残っているかを知らせる。残っている間は `〜に保存しました` を出さない */
  reportFailure: (id: string, failed: boolean) => void;
};

export const SettingsSavedContext = createContext<SettingsSavedValue | null>(null);

function noop() {}

export function useMarkSaved(): () => void {
  return useContext(SettingsSavedContext)?.markSaved ?? noop;
}

export function useReportFailure(): (id: string, failed: boolean) => void {
  return useContext(SettingsSavedContext)?.reportFailure ?? noop;
}

/** 保存の失敗の行（理由ごとに1行にまとめた物）。`title` にリポジトリ名の一覧 */
export function SaveFailureLines({ lines }: { lines: readonly SaveFailureLine[] | undefined }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className={styles.rowError} role="alert">
      {lines.map((line) => (
        <p key={line.text} title={line.title}>
          {line.text}
        </p>
      ))}
    </div>
  );
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
  /** 保存の失敗（理由ごとに1行） */
  failures?: readonly SaveFailureLine[];
  /** 書いている間：右の操作を薄くする */
  busy?: boolean;
  /** 名前の左に置く物（アイコン） */
  icon?: ReactNode;
  /** 行の種類（CSSで行ごとに変えるとき） */
  kind?: string;
};

/** 白い面の1行：左に名前と説明、右に操作。失敗は行の下 */
export function SettingsRow({ name, description, children, below, error, failures, busy, icon, kind }: RowProps) {
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
      <SaveFailureLines lines={failures} />
    </div>
  );
}
