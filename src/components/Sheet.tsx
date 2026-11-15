import type { ReactNode } from "react";
import styles from "./Sheet.module.css";

/** 設定・Issueを書く・見つからないページの本文：ホームと同じ1本の列 */
export function Sheet({ children }: { children: ReactNode }) {
  return <main id="main" className={styles.sheet}>{children}</main>;
}
