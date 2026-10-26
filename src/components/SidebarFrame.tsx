"use client";

import type { ReactNode } from "react";
import { useShell } from "./AppShell";
import styles from "./Sidebar.module.css";

/** サイドバーの枠。スマホ（幅900px未満）では、左から重ねて出す。背景を押すと閉じる */
export function SidebarFrame({
  belowBanner = false,
  children,
}: {
  /** 画面の上に帯がある（デモ）。幅900px以上では帯の下に置く */
  belowBanner?: boolean;
  children: ReactNode;
}) {
  const { menuOpen, closeMenu } = useShell();

  return (
    <>
      <div
        className={styles.backdrop}
        data-open={menuOpen ? "true" : undefined}
        onClick={closeMenu}
        aria-hidden="true"
      />
      <aside
        id="sidebar"
        className={belowBanner ? `${styles.sidebar} ${styles.belowBanner}` : styles.sidebar}
        data-open={menuOpen ? "true" : undefined}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) closeMenu();
        }}
      >
        {children}
      </aside>
    </>
  );
}
