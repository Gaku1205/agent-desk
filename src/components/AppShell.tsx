"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { isFastRefresh, startAutoRefresh, startResumeRefresh } from "@/lib/refresh";
import { KeyboardHelp } from "./KeyboardHelp";

export type ShellState = {
  /** 最後に同期した時刻 */
  syncedAt: Date;
  refreshing: boolean;
  /** 今は10秒ごとに自動で取り直している（AIの番の作業がある）か */
  fastRefresh: boolean;
  /** 回数制限の残りが少なく、この時刻まで自動更新を止めている。止めていなければ null */
  pausedUntil: Date | null;
  refresh: () => void;
  /** 今のページで、取り直しが終わった回数（ページを移ると0に戻る） */
  refreshCountOnPage: number;
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

/** 自動更新を持たない画面（デモ）が、同じ部品を使うために中身を直接渡す */
export const ShellProvider = ShellContext.Provider;

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("AppShell の中で使う");
  return value;
}

/** スマホのメニューの開閉。開いたページでだけ開いている扱い（リンクで移ったら閉じる）。`Esc` で閉じる */
export function useMenuState(): Pick<ShellState, "menuOpen" | "openMenu" | "closeMenu"> {
  const pathname = usePathname();
  const [menuPathname, setMenuPathname] = useState<string | null>(null);
  const menuOpen = menuPathname === pathname;
  const openMenu = useCallback(() => setMenuPathname(pathname), [pathname]);
  const closeMenu = useCallback(() => setMenuPathname(null), []);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuPathname(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  // 開いている間：メニューの外（帯・ページの中身）を inert にして Tab で裏へ出さず、body のスクロールを止める
  useEffect(() => {
    if (!menuOpen) return;
    const sheet = document.getElementById("menu-sheet");
    const outside = Array.from(sheet?.parentElement?.children ?? []).filter(
      (el) => el !== sheet && !el.hasAttribute("inert"),
    );
    outside.forEach((el) => el.setAttribute("inert", ""));
    const { body } = document;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      outside.forEach((el) => el.removeAttribute("inert"));
      body.style.overflow = overflow;
    };
  }, [menuOpen]);

  return { menuOpen, openMenu, closeMenu };
}

/** 自動更新・更新ボタン・スマホのメニューの開閉を、画面全体で共有する */
export function AppShell({
  initialSyncedAt,
  refreshIntervalMs,
  resumeAt,
  children,
}: {
  /** サーバーが最初に取った時刻（ISO文字列） */
  initialSyncedAt: string;
  /** 自動で取り直す間隔。取り直しのたびにサーバーが決め直す。null は自動では取り直さない */
  refreshIntervalMs: number | null;
  /** 自動更新を止めているとき、再開する時刻（ISO文字列） */
  resumeAt: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startTransition] = useTransition();
  const [syncedAt, setSyncedAt] = useState(() => new Date(initialSyncedAt));
  const [requestedAt, setRequestedAt] = useState(syncedAt);
  const [refreshCount, setRefreshCount] = useState({ pathname, count: 0 });

  const refresh = useCallback(() => {
    setRequestedAt(new Date());
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // 取り直しが終わったら、取り直しを始めた時刻を同期の時刻にして、終わった回数を数える
  if (!refreshing && requestedAt !== syncedAt) {
    setSyncedAt(requestedAt);
    setRefreshCount({
      pathname,
      count: refreshCount.pathname === pathname ? refreshCount.count + 1 : 1,
    });
  }

  useEffect(() => {
    if (refreshIntervalMs === null) {
      // 回数制限で止めている間は、再開する時刻に1回だけ取り直す
      if (resumeAt === null) return;
      return startResumeRefresh({ refresh, source: document, resumeAt: new Date(resumeAt) });
    }
    return startAutoRefresh({ refresh, source: document, intervalMs: refreshIntervalMs });
  }, [refresh, refreshIntervalMs, resumeAt]);

  const { menuOpen, openMenu, closeMenu } = useMenuState();

  const value = useMemo<ShellState>(
    () => ({
      syncedAt,
      refreshing,
      fastRefresh: refreshIntervalMs !== null && isFastRefresh(refreshIntervalMs),
      pausedUntil: refreshIntervalMs === null && resumeAt !== null ? new Date(resumeAt) : null,
      refresh,
      refreshCountOnPage: refreshCount.pathname === pathname ? refreshCount.count : 0,
      menuOpen,
      openMenu,
      closeMenu,
    }),
    [
      syncedAt,
      refreshing,
      refreshIntervalMs,
      resumeAt,
      refresh,
      refreshCount,
      pathname,
      menuOpen,
      openMenu,
      closeMenu,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <KeyboardHelp />
    </ShellContext.Provider>
  );
}
