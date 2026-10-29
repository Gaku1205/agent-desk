import type { ReactNode } from "react";
import styles from "./Sheet.module.css";

/** 流れを置かないページの誌面（すりガラス）。設定・見つからないページ */
export function Sheet({ children, narrow = true }: { children: ReactNode; narrow?: boolean }) {
  return <main className={narrow ? `${styles.sheet} ${styles.narrow}` : styles.sheet}>{children}</main>;
}
