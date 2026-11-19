"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PLAY_BUTTON_LABEL } from "@/lib/demo/playback";
import { formatPausedNote, formatSyncTime, getDisplayedSyncTime } from "@/lib/refresh";
import { shouldCloseMenuOnPick, shouldRestoreMenuFocus } from "@/lib/menuFocus";
import { isRepoCountPending } from "@/lib/navCounts";
import { newIssueHref } from "@/lib/issueRepo";
import { hasHiddenBelow } from "@/lib/sideScroll";
import { revealScrollLeft } from "@/lib/tabScroll";
import { currentRepoFromPath, visibleRepos } from "@/lib/visibleRepos";
import type { TurnCounts } from "@/lib/turn";
import { useShell } from "./AppShell";
import { useDemo } from "./DemoContext";
import { ChartIcon, GridIcon, LanesIcon, PlayIcon, PlusIcon, RepoIcon, WriteIcon } from "./icons";
import { ParallelToggle } from "./ParallelToggle";
import { SideUser } from "./SideUser";
import styles from "./TopBar.module.css";

export type TopBarRepo = { owner: string; repo: string };

type Props = {
  repos: TopBarRepo[];
  /** 各ページの「あなたの番」の件数 */
  counts: TurnCounts;
  /** 各ページの「実行中のパイプライン」の件数 */
  runningCounts: TurnCounts;
  /** 件数がまだ届いていない（他のリポジトリの読み込み待ち）。件数は「–」で出す */
  countsPending?: boolean;
  /** 全部が届く前に、件数が届いたリポジトリ（`owner/repo` の小文字）。届いた物は件数を出す */
  countsLoaded?: Record<string, true>;
  /** リンクの頭（デモでは `/demo`） */
  basePath?: string;
  /** ログイン中のユーザー名（デモでは無し） */
  login?: string;
  /** ログアウト（Server Action。デモでは無し） */
  logout?: () => Promise<void>;
  /** デモの帯の残り：GitHubで見る・ログイン */
  extraLinks?: ReactNode;
};

/**
 * 札の右端の2つの件数：あなたの番（アンバーの点）→ 動いている（青の点）。0 でも出す（上端の帯は全部の数が並ぶ）。
 * 数だけが並んで何の数か分からない（同じ数だとバグに見える）ので、誌面の左の凡例と同じ色の点を前に付け、
 * 今いるページの札（labeled）だけは短い名札（あなたの番・AI）も付ける。意味は title と読み上げでも言う
 */
export function Counts({
  turn,
  running,
  labeled,
  pending: countsPending = false,
}: {
  turn: number;
  running: number;
  labeled: boolean;
  /** 件数がまだ届いていない。数の代わりに「–」を出す */
  pending?: boolean;
}) {
  const text = countsPending ? "件数を読み込み中" : `Your turn ${turn}件、AIが動いている ${running}件`;
  // 押した札の点：次の画面が出るまで脈打つ（動きを減らすときは色だけ）。<Link> の子の部品の中で使う
  const { pending } = useLinkStatus();
  return (
    <i
      className={`${styles.counts} num`}
      role="img"
      aria-label={text}
      title={text}
      data-labeled={labeled ? "" : undefined}
      data-pending={pending ? "" : undefined}
    >
      <b className={styles.countTurn} aria-hidden="true">
        {labeled && <span className={styles.countName}>Your turn</span>}
        {countsPending ? "–" : turn}
      </b>
      <b className={styles.countRunning} aria-hidden="true">
        {labeled && <span className={styles.countName}>AI</span>}
        {countsPending ? "–" : running}
      </b>
    </i>
  );
}

/**
 * 押した物の印：次の画面が出るまでの間だけ `data-pending` が付く（見えない）。<Link> の子として置く。
 * CSS の `:has([data-pending])` で、押した物を「今いる」（aria-current と同じ）の見た目にし、押す前にいた物を戻す
 */
function PendingMark() {
  const { pending } = useLinkStatus();
  return <i className={styles.pendingMark} data-pending={pending ? "" : undefined} aria-hidden="true" />;
}

/** メニューの凡例：2つの点が何の数か（点つき） */
export function CountsKey({ className }: { className?: string }) {
  return (
    <span className={className ? `${styles.key} ${className}` : styles.key} aria-hidden="true">
      <span className={styles.keyTurn}>Your turn</span>
      <span className={styles.keyRunning}>AI</span>
    </span>
  );
}

/** 帯の最初の Tab：「あなたの番」の1件の最初のボタンへ移る（無ければ本文の最初の操作へ）。フォーカスしたときだけ見える */
function SkipLink() {
  function skip(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    // 片づけて隠している1件（data-leaving）は飛ばす。大きい1件も、マージ待ちの一覧の行も `data-key` が付いている
    const target =
      document.querySelector<HTMLElement>(
        '[data-skip-target] [data-key]:not([data-leaving]) [data-act]:not([aria-disabled="true"])',
      ) ??
      document.querySelector<HTMLElement>(
        "[data-skip-target] [data-key]:not([data-leaving]) a, [data-skip-target] [data-key]:not([data-leaving]) button",
      ) ??
      document.querySelector<HTMLElement>("main a, main button, main input, main select");
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }
  return (
    <a href="#main" className={styles.skip} onClick={skip}>
      本文へ移る
    </a>
  );
}

/** リポジトリの切り替え（各リポジトリ → すべてのリポジトリ）。上端の帯とスマホのメニューで同じ物 */
export function RepoTabs({
  repos,
  counts,
  runningCounts,
  countsPending = false,
  countsLoaded,
  basePath = "",
  onPick,
}: Pick<Props, "repos" | "counts" | "runningCounts" | "countsPending" | "countsLoaded" | "basePath"> & {
  onPick?: () => void;
}) {
  const pathname = usePathname();
  const isCurrent = (href: string) => pathname.toLowerCase() === href.toLowerCase();
  const allReposHref = `${basePath}/repos`;
  // 動きのあるリポジトリ（あなたの番かAIの番が1件以上）と、今開いているリポジトリだけを出す。全部は「すべてのリポジトリ」で見る。
  // ホームへはワードマークで戻る（ホームにいる間は、どの札も「今いる」にならない）
  const shown = visibleRepos(repos, counts, runningCounts, currentRepoFromPath(pathname));
  const navRef = useRef<HTMLElement>(null);
  // 札が増えて横にスクロールするとき、今いる札が見える位置に来る（動きは付けない）
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const itemLeft = current.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    nav.scrollLeft = revealScrollLeft({
      scrollLeft: nav.scrollLeft,
      viewportWidth: nav.clientWidth,
      scrollWidth: nav.scrollWidth,
      itemLeft,
      itemWidth: current.offsetWidth,
      edge: 20,
    });
  }, [pathname]);
  return (
    <nav className={styles.repos} aria-label="リポジトリ" ref={navRef}>
      {shown.map(({ owner, repo }) => {
        const href = `${basePath}/repos/${owner}/${repo}`;
        const key = `${owner}/${repo}`.toLowerCase();
        return (
          <Link
            key={href}
            href={href}
            className={styles.tab}
            aria-current={isCurrent(href) ? "page" : undefined}
            title={`${owner}/${repo}`}
            onClick={shouldCloseMenuOnPick(pathname, href) ? onPick : undefined}
          >
            <RepoIcon />
            <span className={styles.tabName}>{repo}</span>
            <Counts
              turn={counts.byRepo[key] ?? 0}
              running={runningCounts.byRepo[key] ?? 0}
              labeled={isCurrent(href)}
              pending={isRepoCountPending(countsPending, countsLoaded, key)}
            />
          </Link>
        );
      })}
      <Link
        href={allReposHref}
        className={styles.tab}
        aria-current={isCurrent(allReposHref) ? "page" : undefined}
        title={`すべてのリポジトリ（監視中 ${repos.length}件）`}
        onClick={shouldCloseMenuOnPick(pathname, allReposHref) ? onPick : undefined}
      >
        <GridIcon />
        <span>すべてのリポジトリ</span>
        <i className={`${styles.total} num`} aria-label={`監視中 ${repos.length}件`}>
          {repos.length}
        </i>
        <PendingMark />
      </Link>
    </nav>
  );
}

/** PCの3ペインの左：リポジトリの一覧（上端の帯の札を縦に並べた物。docs/design.md の「PCの3ペイン」） */
export function SideRepos(
  props: Pick<
    Props,
    "repos" | "counts" | "runningCounts" | "countsPending" | "countsLoaded" | "basePath" | "login" | "logout"
  >,
) {
  const pathname = usePathname();
  const newServiceHref = `${props.basePath ?? ""}/new/service`;
  const dashboardHref = `${props.basePath ?? ""}/dashboard`;
  const lanesHref = `${props.basePath ?? ""}/lanes`;
  const listRef = useRef<HTMLDivElement>(null);
  const [hiddenBelow, setHiddenBelow] = useState(false);
  // 札が下の段の下に隠れているときだけ、境目に線を出す（スクロール時・大きさが変わったとき）
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setHiddenBelow(hasHiddenBelow(list));
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    for (const child of Array.from(list.children)) observer.observe(child);
    return () => {
      list.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [props.repos.length, props.counts, props.runningCounts]);
  return (
    <aside className={styles.side} aria-label="リポジトリの一覧">
      <div className={styles.sideList} ref={listRef}>
        <span className={styles.sideLbl}>
          <RepoIcon />
          Repositories
          <CountsKey />
        </span>
        <RepoTabs {...props} />
      </div>
      <div className={styles.sideFoot} data-more={hiddenBelow ? "true" : undefined}>
        <Link
          href={dashboardHref}
          className={`${styles.sideNew} ${styles.sideDash}`}
          aria-current={pathname.toLowerCase() === dashboardHref ? "page" : undefined}
        >
          <ChartIcon />
          <span>Dashboard</span>
          <PendingMark />
        </Link>
        <Link
          href={lanesHref}
          className={`${styles.sideNew} ${styles.sideDash}`}
          aria-current={pathname.toLowerCase() === lanesHref ? "page" : undefined}
        >
          <LanesIcon />
          <span>Slots &amp; Queue</span>
          <PendingMark />
        </Link>
        <Link
          href={newServiceHref}
          className={styles.sideNew}
          aria-label="新しいサービスを作る"
          aria-current={pathname.toLowerCase() === newServiceHref ? "page" : undefined}
        >
          <PlusIcon />
          <span aria-hidden="true">新サービス</span>
          <PendingMark />
        </Link>
        <div className={styles.sideBottom}>
          <ParallelToggle variant="side" />
          <div className={styles.sideSync}>
            <SyncButton />
            <PausedNote />
          </div>
          <SideUser login={props.login} logout={props.logout} basePath={props.basePath} />
        </div>
      </div>
    </aside>
  );
}

/** 同期の時刻（押すと取り直す）。更新中は点が脈打ち、速い更新の間は点が明滅する */
export function SyncButton({ className }: { className?: string }) {
  const { syncedAt, refreshing, fastRefresh, refresh } = useShell();
  return (
    <button
      type="button"
      className={`${styles.sync} num ${className ?? ""}`}
      onClick={refresh}
      disabled={refreshing}
      aria-busy={refreshing}
      aria-label={`更新（最後に取り直した時刻 ${formatSyncTime(getDisplayedSyncTime(syncedAt))}）`}
      title="更新"
    >
      <span
        className={styles.dot}
        data-busy={refreshing ? "true" : undefined}
        data-fast={fastRefresh ? "true" : undefined}
        aria-hidden="true"
      />
      {refreshing ? "同期中" : "同期"} {formatSyncTime(getDisplayedSyncTime(syncedAt))}
    </button>
  );
}

/** 回数制限で自動更新を止めている間だけ出す1行 */
export function PausedNote({ className }: { className?: string }) {
  const { pausedUntil, pausedBy } = useShell();
  if (!pausedUntil) return null;
  const note = formatPausedNote(pausedBy, pausedUntil.getTime() / 1000);
  return (
    <span className={`${styles.paused} ${className ?? ""}`} title={note}>
      {note}
    </span>
  );
}

/** デモの印と再生（デモのときだけ） */
function DemoControls() {
  const demo = useDemo();
  if (!demo) return null;
  return (
    <>
      <span className={styles.demo} title="デモ（サンプルのデータ）">
        <span className={styles.demoFull}>デモ（サンプルのデータ）</span>
        <span className={styles.demoShort}>デモ</span>
      </span>
      <button
        type="button"
        className={styles.play}
        onClick={demo.play}
        disabled={demo.playState === "playing"}
        aria-live="polite"
      >
        <PlayIcon />
        {PLAY_BUTTON_LABEL[demo.playState]}
      </button>
    </>
  );
}

/** 上端の帯：ワードマーク・リポジトリの切り替え・（デモの印と再生）・同期・設定・ユーザー */
export function TopBar(props: Props) {
  const { menuOpen, openMenu, closeMenu } = useShell();
  const pathname = usePathname();
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // 閉じたら（Esc・背景・項目）メニューボタンへフォーカスを戻す。別のページへ移っても body に落とさない
  useEffect(() => {
    const active = document.activeElement;
    const sheet = document.getElementById("menu-sheet");
    if (
      shouldRestoreMenuFocus({
        wasOpen: wasOpenRef.current,
        menuOpen,
        focusInSheet: !!active && !!sheet?.contains(active),
        focusLost: !active || active === document.body || !active.isConnected,
      })
    ) {
      menuBtnRef.current?.focus({ preventScroll: true });
    }
    wasOpenRef.current = menuOpen;
  }, [menuOpen, pathname]);

  return (
    <>
      <header className={styles.top}>
        <SkipLink />
        <button
          type="button"
          className={styles.menuBtn}
          aria-label="メニュー"
          aria-expanded={menuOpen}
          aria-controls="menu-sheet"
          ref={menuBtnRef}
          onClick={menuOpen ? closeMenu : openMenu}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2 5h14M2 9h14M2 13h14" />
          </svg>
        </button>
        <Link href={props.basePath || "/"} className={styles.mark}>
          agent-desk
        </Link>
        <RepoTabs {...props} />
        <div className={styles.right}>
          <DemoControls />
          <PausedNote className={styles.pausedTop} />
          <SyncButton className={styles.syncTop} />
        </div>
      </header>
      <MenuSheet {...props} />
    </>
  );
}

/** スマホのメニュー（左から重ねて出す）。背景を押すか Esc で閉じる */
function MenuSheet(props: Props) {
  const { menuOpen, closeMenu } = useShell();
  const demo = useDemo();
  const pathname = usePathname();
  const newIssueLink = newIssueHref(props.basePath ?? "", currentRepoFromPath(pathname));
  const newServiceHref = `${props.basePath ?? ""}/new/service`;
  const dashboardHref = `${props.basePath ?? ""}/dashboard`;
  const lanesHref = `${props.basePath ?? ""}/lanes`;
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    paneRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [menuOpen]);

  return (
    <div
      className={styles.sheet}
      data-open={menuOpen ? "" : undefined}
      aria-hidden={!menuOpen}
      inert={!menuOpen}
      id="menu-sheet"
    >
      <div className={styles.scrim} onClick={closeMenu} aria-hidden="true" />
      <div className={styles.pane} role="dialog" aria-modal="true" aria-label="メニュー" ref={paneRef}>
        <span className={styles.mark}>agent-desk</span>
        <span className={`${styles.lbl} ${styles.lblRow}`}>
          <RepoIcon />
          Repositories
          <CountsKey />
        </span>
        <RepoTabs {...props} onPick={closeMenu} />
        <span className={styles.lbl}>ほか</span>
        <Link
          href={newServiceHref}
          className={styles.lnk}
          onClick={shouldCloseMenuOnPick(pathname, newServiceHref) ? closeMenu : undefined}
        >
          <PlusIcon />
          新しいサービスを作る
          <PendingMark />
        </Link>
        <Link
          href={newIssueLink}
          className={styles.lnk}
          onClick={shouldCloseMenuOnPick(pathname, newIssueLink) ? closeMenu : undefined}
        >
          <WriteIcon />
          Issueを書く
          <PendingMark />
        </Link>
        <Link
          href={dashboardHref}
          className={styles.lnk}
          aria-current={pathname.toLowerCase() === dashboardHref ? "page" : undefined}
          onClick={shouldCloseMenuOnPick(pathname, dashboardHref) ? closeMenu : undefined}
        >
          <ChartIcon />
          Dashboard
          <PendingMark />
        </Link>
        <Link
          href={lanesHref}
          className={styles.lnk}
          aria-current={pathname.toLowerCase() === lanesHref ? "page" : undefined}
          onClick={shouldCloseMenuOnPick(pathname, lanesHref) ? closeMenu : undefined}
        >
          <LanesIcon />
          Slots &amp; Queue
          <PendingMark />
        </Link>
        {props.extraLinks}
        <ParallelToggle variant="menu" />
        <div className={styles.foot}>
          {demo && <span className={styles.demo}>デモ（サンプルのデータ）</span>}
          <SyncButton />
          <PausedNote />
          <SideUser login={props.login} logout={props.logout} basePath={props.basePath} onPick={closeMenu} />
        </div>
      </div>
    </div>
  );
}
