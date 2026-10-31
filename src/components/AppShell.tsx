"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { syncNow } from "@/app/actions";
import {
  parseChangeMarks,
  startChangeWatch,
  type ChangeMarks,
  type ChangeMarksResult,
} from "@/lib/changeMarks";
import {
  getIntervalWhileWatching,
  isFastRefresh,
  startAutoRefresh,
  startResumeRefresh,
} from "@/lib/refresh";
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

/** 「変わった」印を `/api/changes` から読む。404 は Webhook を使わない設定 */
async function loadChangeMarks(repos: string[]): Promise<ChangeMarksResult> {
  const query = repos.map((repo) => `repo=${encodeURIComponent(repo)}`).join("&");
  const response = await fetch(`/api/changes?${query}`, { cache: "no-store" });
  if (response.status === 404) return "unavailable";
  if (!response.ok) return null;
  return parseChangeMarks(await response.json());
}

/** 自動更新・更新ボタン・スマホのメニューの開閉を、画面全体で共有する */
export function AppShell({
  initialSyncedAt,
  refreshIntervalMs,
  resumeAt,
  changeRepos,
  appliedChangeMarks,
  needsIntervalRefresh,
  graceRefreshAt,
  children,
}: {
  /** サーバーが最初に取った時刻（ISO文字列） */
  initialSyncedAt: string;
  /** 自動で取り直す間隔。取り直しのたびにサーバーが決め直す。null は自動では取り直さない */
  refreshIntervalMs: number | null;
  /** 自動更新を止めているとき、再開する時刻（ISO文字列） */
  resumeAt: string | null;
  /** Webhook で「変わった」ときだけ取り直すリポジトリ（`owner/repo`） */
  changeRepos: string[];
  /** そのリポジトリの、今のデータに反映済みの「変わった」印 */
  appliedChangeMarks: ChangeMarks;
  /** 今までどおりの間隔の取り直しが要るか（ログインした人のトークンで読むリポジトリがある） */
  needsIntervalRefresh: boolean;
  /** 次に猶予（PR作成待ち・未着手）が終わる時刻の少し後（ISO文字列）。猶予の中の物が無ければ null */
  graceRefreshAt: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startTransition] = useTransition();
  const [syncedAt, setSyncedAt] = useState(() => new Date(initialSyncedAt));
  const [requestedAt, setRequestedAt] = useState(syncedAt);
  const [refreshCount, setRefreshCount] = useState({ pathname, count: 0 });
  // `/api/changes` が 404 だった（Webhook を使わない設定）。今までどおりの間隔に戻す
  const [changesUnavailable, setChangesUnavailable] = useState(false);
  // 取り直しのたびに配列は新しくなるので、中身が同じなら見張りを続ける
  const changeReposKey = changeRepos.join(",");
  const watching = changeReposKey !== "" && !changesUnavailable;
  const intervalMs = getIntervalWhileWatching({
    planned: refreshIntervalMs,
    watching,
    needsIntervalRefresh,
  });

  // 自動の取り直し（キャッシュがあれば使う）
  const autoRefresh = useCallback(() => {
    setRequestedAt(new Date());
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // 手で押す「同期」：キャッシュを無視して、すぐ取り直す
  const refresh = useCallback(() => {
    setRequestedAt(new Date());
    startTransition(async () => {
      await syncNow();
    });
  }, []);

  // 取り直しが終わったら、取り直しを始めた時刻を同期の時刻にして、終わった回数を数える
  if (!refreshing && requestedAt !== syncedAt) {
    setSyncedAt(requestedAt);
    setRefreshCount({
      pathname,
      count: refreshCount.pathname === pathname ? refreshCount.count + 1 : 1,
    });
  }

  useEffect(() => {
    if (intervalMs === null) {
      // 回数制限で止めている間は、再開する時刻に1回だけ取り直す
      if (resumeAt === null) return;
      return startResumeRefresh({
        refresh: autoRefresh,
        source: document,
        resumeAt: new Date(resumeAt),
      });
    }
    return startAutoRefresh({ refresh: autoRefresh, source: document, intervalMs });
  }, [autoRefresh, intervalMs, resumeAt]);

  // 猶予が終わる時刻の直後に1回だけ取り直す（猶予の終わりは Webhook が来ない）。
  // 取り直したあとに新しい時刻が渡されたら、また同じようにする
  useEffect(() => {
    if (graceRefreshAt === null) return;
    return startResumeRefresh({
      refresh: autoRefresh,
      source: document,
      resumeAt: new Date(graceRefreshAt),
    });
  }, [autoRefresh, graceRefreshAt]);

  // 見張りが使うリポジトリと反映済みの印は、取り直しのたびに新しくなる。見張りを作り直さずに最新の物を読めるよう ref で持つ
  const changeReposRef = useRef(changeReposKey);
  const appliedChangeMarksRef = useRef(appliedChangeMarks);
  useEffect(() => {
    changeReposRef.current = changeReposKey;
    appliedChangeMarksRef.current = appliedChangeMarks;
  }, [changeReposKey, appliedChangeMarks]);

  // 見えている間、5秒ごとに「変わった」印を見て、反映済みより新しいリポジトリがあるときだけ取り直す。止めている間は見ない。
  // 作り直すのは見るかどうかが変わるときだけ（間隔が20秒⇔30秒に変わっても作り直さない）
  const watchActive = watching && refreshIntervalMs !== null;
  useEffect(() => {
    if (!watchActive) return;
    return startChangeWatch({
      load: () => loadChangeMarks(changeReposRef.current.split(",")),
      getApplied: () => appliedChangeMarksRef.current,
      refresh: autoRefresh,
      onUnavailable: () => setChangesUnavailable(true),
      source: document,
    });
  }, [watchActive, autoRefresh]);

  const { menuOpen, openMenu, closeMenu } = useMenuState();

  const value = useMemo<ShellState>(
    () => ({
      syncedAt,
      refreshing,
      // 実際に使っている間隔（5分の保険のときは5分）で決める
      fastRefresh: isFastRefresh(intervalMs),
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
      intervalMs,
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
