"use client";

import { useShell } from "./AppShell";

/** スマホのヘッダーの左端のメニューボタン（幅900px以上では出さない） */
export function MenuButton() {
  const { menuOpen, openMenu, closeMenu } = useShell();

  return (
    <button
      type="button"
      className="menu-button"
      aria-label="メニュー"
      aria-expanded={menuOpen}
      aria-controls="sidebar"
      onClick={menuOpen ? closeMenu : openMenu}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}
