"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { PLAY_BUTTON_LABEL } from "@/lib/demo/playback";
import { formatResetTime, formatSyncTime, getDisplayedSyncTime } from "@/lib/refresh";
import type { TurnCounts } from "@/lib/turn";
import { useShell } from "./AppShell";
import { useDemo } from "./DemoContext";
import { GearIcon } from "./icons";
import styles from "./TopBar.module.css";

export type TopBarRepo = { owner: string; repo: string };

type Props = {
  repos: TopBarRepo[];
  /** 各ページの「あなたの番」の件数 */
  counts: TurnCounts;
  /** 各ページの「実行中のパイプライン」の件数 */
  runningCounts: TurnCounts;
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
function Counts({ turn, running, labeled }: { turn: number; running: number; labeled: boolean }) {
  const text = `あなたの番 ${turn}件、AIが動いている ${running}件`;
  return (
    <i className={`${styles.counts} num`} aria-label={text} title={text} data-labeled={labeled ? "" : undefined}>
      <b className={styles.countTurn} aria-hidden="true">
        {labeled && <span className={styles.countName}>あなたの番</span>}
        {turn}
      </b>
      <b className={styles.countRunning} aria-hidden="true">
        {labeled && <span className={styles.countName}>AI</span>}
        {running}
      </b>
    </i>
  );
}

/** メニューの凡例：2つの点が何の数か（点つき） */
function CountsKey() {
  return (
    <span className={styles.key} aria-hidden="true">
      <span className={styles.keyTurn}>あなたの番</span>
      <span className={styles.keyRunning}>AI</span>
    </span>
  );
}

/** 帯の最初の Tab：押す列の最初のボタンへ移る（無ければ本文の最初の操作へ）。フォーカスしたときだけ見える */
function SkipLink() {
  function skip(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const target =
      document.querySelector<HTMLElement>("[data-skip-target] [data-act]:not(:disabled)") ??
      document.querySelector<HTMLElement>("[data-skip-target] a, [data-skip-target] button") ??
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

/** リポジトリの切り替え（全部 → 各リポジトリ）。上端の帯とスマホのメニューで同じ物 */
export function RepoTabs({
  repos,
  counts,
  runningCounts,
  basePath = "",
  onPick,
}: Pick<Props, "repos" | "counts" | "runningCounts" | "basePath"> & { onPick?: () => void }) {
  const pathname = usePathname();
  const isCurrent = (href: string) => pathname.toLowerCase() === href.toLowerCase();
  const home = basePath || "/";
  return (
    <nav className={styles.repos} aria-label="リポジトリ">
      <Link
        href={home}
        className={styles.tab}
        aria-current={isCurrent(home) ? "page" : undefined}
        onClick={onPick}
      >
        <span>全部</span>
        <Counts turn={counts.total} running={runningCounts.total} labeled={isCurrent(home)} />
      </Link>
      {repos.map(({ owner, repo }) => {
        const href = `${basePath}/repos/${owner}/${repo}`;
        const key = `${owner}/${repo}`.toLowerCase();
        return (
          <Link
            key={href}
            href={href}
            className={styles.tab}
            aria-current={isCurrent(href) ? "page" : undefined}
            title={`${owner}/${repo}`}
            onClick={onPick}
          >
            <span className={styles.tabName}>{repo}</span>
            <Counts
              turn={counts.byRepo[key] ?? 0}
              running={runningCounts.byRepo[key] ?? 0}
              labeled={isCurrent(href)}
            />
          </Link>
        );
      })}
    </nav>
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
      {refreshing ? "更新中" : "同期"} {formatSyncTime(getDisplayedSyncTime(syncedAt))}
    </button>
  );
}

/** 回数制限で自動更新を止めている間だけ出す1行 */
export function PausedNote({ className }: { className?: string }) {
  const { pausedUntil } = useShell();
  if (!pausedUntil) return null;
  return (
    <span className={`${styles.paused} ${className ?? ""}`}>
      回数制限の残りが少ないため、自動更新を止めています（{formatResetTime(pausedUntil.getTime() / 1000)} に再開）
    </span>
  );
}

/** デモの印と再生（デモのときだけ） */
function DemoControls() {
  const demo = useDemo();
  if (!demo) return null;
  return (
    <>
      <span className={styles.demo}>デモ（サンプルのデータ）</span>
      <button
        type="button"
        className={styles.play}
        onClick={demo.play}
        disabled={demo.playState === "playing"}
        aria-live="polite"
      >
        {PLAY_BUTTON_LABEL[demo.playState]}
      </button>
    </>
  );
}

/** 上端の帯：ワードマーク・リポジトリの切り替え・（デモの印と再生）・同期・設定・ユーザー */
export function TopBar(props: Props) {
  const { menuOpen, openMenu, closeMenu } = useShell();
  const pathname = usePathname();
  const settingsHref = `${props.basePath ?? ""}/settings`;

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
          <Link
            href={settingsHref}
            className={styles.gear}
            aria-current={pathname.toLowerCase() === settingsHref ? "page" : undefined}
          >
            <GearIcon />
            設定
          </Link>
          {props.login && props.logout && (
            <form action={props.logout} className={styles.user}>
              <span className={`${styles.login} num`}>{props.login}</span>
              <LogoutButton />
            </form>
          )}
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
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    paneRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [menuOpen]);

  return (
    <div className={styles.sheet} data-open={menuOpen ? "" : undefined} aria-hidden={!menuOpen} id="menu-sheet">
      <div className={styles.scrim} onClick={closeMenu} aria-hidden="true" />
      <div className={styles.pane} role="dialog" aria-label="メニュー" ref={paneRef}>
        <span className={styles.mark}>agent-desk</span>
        <span className={`${styles.lbl} ${styles.lblRow}`}>
          リポジトリ
          <CountsKey />
        </span>
        <RepoTabs {...props} onPick={closeMenu} />
        <span className={styles.lbl}>ほか</span>
        <Link href={`${props.basePath ?? ""}/settings`} className={styles.lnk} onClick={closeMenu}>
          <GearIcon />
          設定
        </Link>
        {props.extraLinks}
        <div className={styles.foot}>
          {demo && <span className={styles.demo}>デモ（サンプルのデータ）</span>}
          <SyncButton />
          <PausedNote />
          {props.login && props.logout && (
            <form action={props.logout} className={styles.user}>
              <span className={`${styles.login} num`}>{props.login}</span>
              <LogoutButton />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** ログアウトのボタン（PCの帯とスマホのメニューで同じ）：送信の最中は文言を変え、押せなくする */
function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.logout} disabled={pending}>
      {pending ? "ログアウト中…" : "ログアウト"}
    </button>
  );
}
