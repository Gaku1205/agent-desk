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
import { isRefreshKey, startAutoRefresh } from "@/lib/refresh";

type ShellState = {
  /** 最後に同期した時刻 */
  syncedAt: Date;
  refreshing: boolean;
  refresh: () => void;
  /** 今のページで、取り直しが終わった回数（ページを移ると0に戻る） */
  refreshCountOnPage: number;
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("AppShell の中で使う");
  return value;
}

/** 自動更新・更新ボタン・`R` キー・スマホのメニューの開閉を、画面全体で共有する */
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
  const [menuPathname, setMenuPathname] = useState<string | null>(null);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const handled = isRefreshKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        targetTag: target?.tagName ?? "",
        targetEditable: target?.isContentEditable ?? false,
      });
      if (!handled) return;
      event.preventDefault();
      refresh();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refresh]);

  // メニューは開いたページでだけ開いている扱い（リンクで移ったら閉じる）
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

  const value = useMemo<ShellState>(
    () => ({
      syncedAt,
      refreshing,
      refresh,
      refreshCountOnPage: refreshCount.pathname === pathname ? refreshCount.count : 0,
      menuOpen,
      openMenu,
      closeMenu,
    }),
    [syncedAt, refreshing, refresh, refreshCount, pathname, menuOpen, openMenu, closeMenu],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
