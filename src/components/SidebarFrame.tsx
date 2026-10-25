"use client";

import type { ReactNode } from "react";
import { useShell } from "./AppShell";

/** サイドバーの枠。スマホ（幅900px未満）では、左から重ねて出す。背景を押すと閉じる */
export function SidebarFrame({ children }: { children: ReactNode }) {
  const { menuOpen, closeMenu } = useShell();

  return (
    <>
      <div
        className="sidebar-backdrop"
        data-open={menuOpen ? "true" : undefined}
        onClick={closeMenu}
        aria-hidden="true"
      />
      <aside
        id="sidebar"
        className="sidebar"
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
