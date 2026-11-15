import type { ReactNode } from "react";
import styles from "./Sheet.module.css";

/** 設定・Issueを書く・見つからないページの誌面（すりガラス） */
export function Sheet({ children, narrow = true }: { children: ReactNode; narrow?: boolean }) {
  return <main id="main" className={narrow ? `${styles.sheet} ${styles.narrow}` : styles.sheet}>{children}</main>;
}
