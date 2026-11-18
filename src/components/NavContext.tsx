"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DeskNav } from "./Desk";

const NavContext = createContext<DeskNav | null>(null);

/**
 * 左のバー用の情報（リポジトリ・件数・ユーザー）を、layout から読み込み中の骨組みへ渡す。
 * 左のバーは各ページの本文の中にあるので、読み込み中も消さないために骨組みの側で同じ物を描く
 */
export function NavProvider({ value, children }: { value: DeskNav; children: ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): DeskNav | null {
  return useContext(NavContext);
}
