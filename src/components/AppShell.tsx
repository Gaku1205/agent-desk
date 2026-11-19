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
import { callAction } from "@/lib/actionCall";
import { requestedAtAfterSync, SYNC_WAIT_LIMIT_MS, syncAfterPlan } from "@/lib/syncWait";
import {
  changesPollIntervalMs,
  parseChangeMarks,
  shouldRequestRefresh,
  startChangeWatch,
  type ChangeMarks,
  type ChangeMarksResult,
} from "@/lib/changeMarks";
import {
  getIntervalWhileWatching,
  isFastRefresh,
  startAutoRefresh,
  startResumeRefresh,
  type PausedBy,
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
  /** 止めているとき、どの鍵・どの枠の残りが少ないか（分からなければ null） */
  pausedBy: PausedBy | null;
  /** 手で押した同期が届かなかった（次に取り直せたら false に戻る） */
  syncFailed: boolean;
  /** 最後の取り直しで、全部のリポジトリが GitHub から読めなかった（同期の時刻は最後に読めた時刻のまま。次に読めたら false） */
  readFailed: boolean;
  refresh: () => void;
  /** 今のページで、取り直しが終わった回数（ページを移ると0に戻る） */
  refreshCountOnPage: number;
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

/**
 * 自動更新の計画。全リポジトリを読み終えてからサーバーが決める物で、layout が Suspense で後から流す
 * （中央の中身を待たせないため）。届くまでは自動では取り直さない
 */
export type ShellPlan = {
  /** サーバーがこの計画を作った時刻（ISO文字列）。同期が反映されたかの印にも使う。届く前は空 */
  loadedAt: string;
  /** 自動で取り直す間隔。取り直しのたびにサーバーが決め直す。null は自動では取り直さない */
  refreshIntervalMs: number | null;
  /** 自動更新を止めているとき、再開する時刻（ISO文字列） */
  resumeAt: string | null;
  /** 自動更新を止めているとき、どの鍵・どの枠の残りが少ないか（分からなければ null） */
  pausedBy: PausedBy | null;
  /** Webhook で「変わった」ときだけ取り直すリポジトリ（`owner/repo`） */
  changeRepos: string[];
  /** そのリポジトリの、今のデータに反映済みの「変わった」印 */
  appliedChangeMarks: ChangeMarks;
  /** 今までどおりの間隔の取り直しが要るか（ログインした人のトークンで読むリポジトリがある） */
  needsIntervalRefresh: boolean;
  /** 次に猶予（PR作成待ち・未着手）が終わる時刻の少し後（ISO文字列）。猶予の中の物が無ければ null */
  graceRefreshAt: string | null;
  /** 全部のリポジトリが GitHub から読めなかった（`resolveLoadState` の同期の状態が「全部読めなかった」） */
  readFailed: boolean;
};

const NO_PLAN: ShellPlan = {
  readFailed: false,
  loadedAt: "",
  refreshIntervalMs: null,
  resumeAt: null,
  pausedBy: null,
  changeRepos: [],
  appliedChangeMarks: {},
  needsIntervalRefresh: false,
  graceRefreshAt: null,
};

const SetPlanContext = createContext<((plan: ShellPlan) => void) | null>(null);

/** 後から届いた自動更新の計画を AppShell に渡す（`LayoutFeed` が使う） */
export function useSetShellPlan(): ((plan: ShellPlan) => void) | null {
  return useContext(SetPlanContext);
}

/** 自動更新を持たない画面（デモ）が、同じ部品を使うために中身を直接渡す */
export const ShellProvider = ShellContext.Provider;

export function useShell(): ShellState {
  const value = useContext(ShellContext);
  if (!value) throw new Error("AppShell の中で使う");
  return value;
}

/** メニューが `inert` を付けた要素の印。外すときはこの印の付いた物だけを全部外す（ほかの `inert` には触らない） */
const MENU_INERT = "data-menu-inert";

/** メニューの外の `inert` を、開閉の状態に合わせて決め直す（閉じていれば、印の付いた物を全部外す） */
function syncMenuInert(open: boolean) {
  const sheet = document.getElementById("menu-sheet");
  const marked = Array.from(document.querySelectorAll(`[${MENU_INERT}]`));
  const outside = open
    ? Array.from(sheet?.parentElement?.children ?? []).filter((el) => el !== sheet && (el.hasAttribute(MENU_INERT) || !el.hasAttribute("inert")))
    : [];
  for (const el of marked) {
    if (outside.includes(el)) continue;
    el.removeAttribute("inert");
    el.removeAttribute(MENU_INERT);
  }
  for (const el of outside) {
    el.setAttribute("inert", "");
    el.setAttribute(MENU_INERT, "");
  }
}

/** スマホのメニューの開閉。開いたページでだけ開いている扱い（リンクで移ったら閉じる）。`Esc` で閉じる */
export function useMenuState(): Pick<ShellState, "menuOpen" | "openMenu" | "closeMenu"> {
  const pathname = usePathname();
  const [menuPathname, setMenuPathname] = useState<string | null>(null);
  const menuOpen = menuPathname === pathname;
  const openMenu = useCallback(() => setMenuPathname(pathname), [pathname]);
  const closeMenu = useCallback(() => setMenuPathname(null), []);

  // ハイドレーション前に押されて開いていたら、その状態を引き継ぐ（先行スクリプトが DOM だけ開いている）
  useEffect(() => {
    if (!window.__menuPreOpen) return;
    window.__menuPreOpen = false;
    document.body.style.overflow = "";
    queueMicrotask(() => setMenuPathname(pathname));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuPathname(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  // 開いている間：メニューの外（帯・ページの中身）を inert にして Tab で裏へ出さず、body のスクロールを止める。
  // 付けた要素を覚えて外すのではなく、開閉の状態から毎回決め直す（入れ替えで要素が替わっても、閉じたら印の付いた物を全部外す）
  useEffect(() => {
    syncMenuInert(menuOpen);
    if (!menuOpen) return;
    const sheet = document.getElementById("menu-sheet");
    // 開いている間に流れてきた要素（読み込みの続き・入れ替え）にも付ける
    const observer = new MutationObserver(() => syncMenuInert(true));
    if (sheet?.parentElement) observer.observe(sheet.parentElement, { childList: true });
    const { body } = document;
    const overflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      observer.disconnect();
      syncMenuInert(false);
      body.style.overflow = overflow;
    };
  }, [menuOpen, pathname]);

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
  children,
}: {
  /** サーバーが最初に描いた時刻（ISO文字列） */
  initialSyncedAt: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [plan, setPlan] = useState<ShellPlan>(NO_PLAN);
  const { refreshIntervalMs, resumeAt, changeRepos, appliedChangeMarks, needsIntervalRefresh, graceRefreshAt } = plan;
  // 手で押した同期を押した時点の計画の時刻。新しい計画（＝全リポジトリの取り直しの結果）が届くまで「同期中」にする
  const [syncFrom, setSyncFrom] = useState<string | null>(null);
  const planLoadedAtRef = useRef(plan.loadedAt);
  useEffect(() => {
    planLoadedAtRef.current = plan.loadedAt;
  }, [plan.loadedAt]);
  const waitingForSync = syncFrom !== null && plan.loadedAt === syncFrom;
  const refreshing = pending || waitingForSync;
  const [syncedAt, setSyncedAt] = useState(() => new Date(initialSyncedAt));
  const [requestedAt, setRequestedAt] = useState(syncedAt);
  const [syncFailed, setSyncFailed] = useState(false);
  // 手で押した同期が届かなかったとき、同期の時刻を戻す先（最後に取り直せた時刻）
  const syncedAtRef = useRef(syncedAt);
  useEffect(() => {
    syncedAtRef.current = syncedAt;
  }, [syncedAt]);
  // 届かないまま待ち続けないための上限
  useEffect(() => {
    if (!waitingForSync) return;
    const timer = setTimeout(() => {
      // 届いていないので、同期の時刻は進めない（最後に取り直せた時刻へ戻す）
      setRequestedAt(
        requestedAtAfterSync({ requestedAt: new Date(), lastSyncedAt: syncedAtRef.current, reached: false }),
      );
      setSyncFailed(true);
      setSyncFrom(null);
    }, SYNC_WAIT_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [waitingForSync]);
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
    // 押した瞬間に「同期中」にする（サーバーの返事を待たない）
    setRequestedAt(new Date());
    setSyncFailed(false);
    setSyncFrom(planLoadedAtRef.current);
    startTransition(async () => {
      // 呼び出しが投げても（通信が切れた・古い画面のまま押した）、画面を落とさない。
      // 取り直せていないので、同期の時刻は進めない（最後に取り直せた時刻のまま）
      const reached = await callAction(
        async () => {
          await syncNow();
          // 取り直しは裏で行う（届くまで今の中身を出し続ける）
          startTransition(() => router.refresh());
          return true;
        },
        () => false,
      );
      if (!reached) {
        setRequestedAt(
          requestedAtAfterSync({ requestedAt: new Date(), lastSyncedAt: syncedAtRef.current, reached }),
        );
        setSyncFailed(true);
        setSyncFrom(null);
      }
    });
  }, [router]);

  // 取り直しの結果（新しい計画）が届いた：全部読めなかったなら、同期の時刻を進めず最後に読めた時刻へ戻す
  const [seenPlanAt, setSeenPlanAt] = useState(plan.loadedAt);
  const [lastReadAt, setLastReadAt] = useState(syncedAt);
  if (plan.loadedAt !== seenPlanAt) {
    setSeenPlanAt(plan.loadedAt);
    const next = syncAfterPlan({ readFailed: plan.readFailed, requestedAt, lastReadAt });
    setLastReadAt(next.lastReadAt);
    if (plan.readFailed) {
      setRequestedAt(next.shownAt);
      setSyncedAt(next.shownAt);
    }
  } else if (!refreshing && requestedAt !== syncedAt) {
    // 取り直しが終わったら、取り直しを始めた時刻を同期の時刻にして、終わった回数を数える
    setSyncedAt(requestedAt);
    setSyncFailed(false);
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

  // 見えている間、5秒ごと（AIの番の作業がある間は2.5秒ごと）に「変わった」印を見て、反映済みより新しいリポジトリがあるときだけ取り直す。
  // 止めている間は見ない。作り直すのは見るかどうか・見に行く間隔が変わるときだけ（反映済みの印が新しくなっても作り直さない）
  const watchActive = watching && refreshIntervalMs !== null;
  // 印を見て頼んだ取り直しの結果（新しい計画）が届くまでは、重ねて頼まない
  const watchRefreshAtRef = useRef<number | null>(null);
  useEffect(() => {
    watchRefreshAtRef.current = null;
  }, [plan.loadedAt]);
  const watchRefresh = useCallback(() => {
    const now = Date.now();
    if (!shouldRequestRefresh({ requestedAt: watchRefreshAtRef.current, now })) return;
    watchRefreshAtRef.current = now;
    autoRefresh();
  }, [autoRefresh]);
  const pollMs = changesPollIntervalMs(isFastRefresh(refreshIntervalMs));
  useEffect(() => {
    if (!watchActive) return;
    return startChangeWatch({
      load: () => loadChangeMarks(changeReposRef.current.split(",")),
      getApplied: () => appliedChangeMarksRef.current,
      refresh: watchRefresh,
      onUnavailable: () => setChangesUnavailable(true),
      source: document,
      intervalMs: pollMs,
    });
  }, [watchActive, watchRefresh, pollMs]);

  const { menuOpen, openMenu, closeMenu } = useMenuState();

  const value = useMemo<ShellState>(
    () => ({
      syncedAt,
      refreshing,
      // 実際に使っている間隔（5分の保険のときは5分）で決める
      fastRefresh: isFastRefresh(intervalMs),
      pausedUntil: refreshIntervalMs === null && resumeAt !== null ? new Date(resumeAt) : null,
      pausedBy: refreshIntervalMs === null && resumeAt !== null ? plan.pausedBy : null,
      syncFailed,
      readFailed: plan.readFailed,
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
      plan.pausedBy,
      plan.readFailed,
      syncFailed,
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
      <SetPlanContext.Provider value={setPlan}>
        {children}
        <KeyboardHelp />
      </SetPlanContext.Provider>
    </ShellContext.Provider>
  );
}
