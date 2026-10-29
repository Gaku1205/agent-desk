"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
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

/** 行の右端の2つの件数：あなたの番（アンバー）→ 動いている（青）。0 でも出す（上端の帯は全部の数が並ぶ） */
function Counts({ turn, running }: { turn: number; running: number }) {
  return (
    <i className={`${styles.counts} num`} aria-label={`あなたの番 ${turn}件、動いている ${running}件`}>
      <b className={styles.countTurn}>{turn}</b>
      <b className={styles.countRunning}>{running}</b>
    </i>
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
        <Counts turn={counts.total} running={runningCounts.total} />
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
            <Counts turn={counts.byRepo[key] ?? 0} running={runningCounts.byRepo[key] ?? 0} />
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
              <button type="submit" className={styles.logout}>
                ログアウト
              </button>
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
        <span className={styles.lbl}>リポジトリ</span>
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
              <button type="submit" className={styles.logout}>
                ログアウト
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
