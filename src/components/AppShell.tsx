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
import { isFastRefresh, startAutoRefresh } from "@/lib/refresh";

export type ShellState = {
  /** 最後に同期した時刻 */
  syncedAt: Date;
  refreshing: boolean;
  /** 今は10秒ごとに自動で取り直している（AIの番の作業がある）か */
  fastRefresh: boolean;
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

  return { menuOpen, openMenu, closeMenu };
}

/** 自動更新・更新ボタン・スマホのメニューの開閉を、画面全体で共有する */
export function AppShell({
  initialSyncedAt,
  refreshIntervalMs,
  children,
}: {
  /** サーバーが最初に取った時刻（ISO文字列） */
  initialSyncedAt: string;
  /** 自動で取り直す間隔。取り直しのたびにサーバーが決め直す */
  refreshIntervalMs: number;
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

  useEffect(
    () => startAutoRefresh({ refresh, source: document, intervalMs: refreshIntervalMs }),
    [refresh, refreshIntervalMs],
  );

  const { menuOpen, openMenu, closeMenu } = useMenuState();

  const value = useMemo<ShellState>(
    () => ({
      syncedAt,
      refreshing,
      fastRefresh: isFastRefresh(refreshIntervalMs),
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
      refresh,
      refreshCount,
      pathname,
      menuOpen,
      openMenu,
      closeMenu,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
