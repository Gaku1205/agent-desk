"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TurnCounts } from "@/lib/turn";
import { FileIcon, GearIcon, HomeIcon } from "./icons";
import styles from "./Sidebar.module.css";

type Props = {
  repos: { owner: string; repo: string }[];
  /** 各ページの「あなたの番」の件数 */
  counts: TurnCounts;
  /** 各ページの「実行中のパイプライン」の件数 */
  runningCounts: TurnCounts;
  /** リンクの頭（デモでは `/demo`） */
  basePath?: string;
};

/** サイドバーの下のまとまり（同期・更新）の上に置く「設定」へのリンク */
export function SettingsLink({ basePath = "" }: { basePath?: string }) {
  const pathname = usePathname();
  const href = `${basePath}/settings`;

  return (
    <nav aria-label="設定" className={styles.settings}>
      <Link
        href={href}
        className={styles.item}
        aria-current={pathname.toLowerCase() === href ? "page" : undefined}
      >
        <GearIcon />
        <span className={styles.itemLabel}>設定</span>
      </Link>
    </nav>
  );
}

/** 行の右端の2つの件数：あなたの番（オレンジ）→ 実行中（青）。リポジトリの行は 0 なら出さない */
function Counts({ turn, running, hideZero }: { turn: number; running: number; hideZero: boolean }) {
  const showTurn = !hideZero || turn > 0;
  const showRunning = !hideZero || running > 0;
  if (!showTurn && !showRunning) return null;
  return (
    <span className={styles.counts}>
      {showTurn && (
        <span role="img" aria-label={`あなたの番 ${turn}件`} className={`${styles.count} mono`}>
          {turn}
        </span>
      )}
      {showRunning && (
        <span role="img" aria-label={`実行中 ${running}件`} className={`${styles.count} ${styles.countRunning} mono`}>
          {running}
        </span>
      )}
    </span>
  );
}

export function SidebarNav({ repos, counts, runningCounts, basePath = "" }: Props) {
  const pathname = usePathname();
  const isCurrent = (href: string) =>
    pathname.toLowerCase() === href.toLowerCase();

  return (
    <nav aria-label="リポジトリ" className={styles.nav}>
      <Link
        href={basePath || "/"}
        className={styles.item}
        aria-current={isCurrent(basePath || "/") ? "page" : undefined}
      >
        <HomeIcon />
        <span className={styles.itemLabel}>ホーム</span>
        <Counts turn={counts.total} running={runningCounts.total} hideZero={false} />
      </Link>

      <p className={styles.heading}>リポジトリ</p>
      {repos.map(({ owner, repo }) => {
        const href = `${basePath}/repos/${owner}/${repo}`;
        const key = `${owner}/${repo}`.toLowerCase();
        return (
          <Link
            key={href}
            href={href}
            className={`${styles.item} ${styles.repo}`}
            aria-current={isCurrent(href) ? "page" : undefined}
            title={`${owner}/${repo}`}
          >
            <FileIcon />
            <span className={`${styles.itemLabel} mono`}>{repo}</span>
            <Counts
              turn={counts.byRepo[key] ?? 0}
              running={runningCounts.byRepo[key] ?? 0}
              hideZero
            />
          </Link>
        );
      })}
    </nav>
  );
}
