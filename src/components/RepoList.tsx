"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import { getBrowserStorage } from "@/lib/motion";
import { formatLastActivity, sortRepoRows, type RepoListRow } from "@/lib/repoList";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import { getSidebarSnapshot, subscribeSidebar, type DeskNav } from "./Desk";
import { PanelLeftIcon, PlusIcon } from "./icons";
import styles from "./RepoList.module.css";
import { Counts, CountsKey, SideRepos } from "./TopBar";

type Props = {
  rows: RepoListRow[];
  /** 「今」（ISO文字列） */
  now: string;
  nav: DeskNav;
};

/** 「すべてのリポジトリ」（`/repos`、デモは `/demo/repos`）：監視中の全部を1行ずつ。左のバーはホームと同じ */
export function RepoList({ rows, now, nav }: Props) {
  const basePath = nav.basePath ?? "";
  const sorted = sortRepoRows(rows);
  const at = new Date(now);
  const sideCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const toggleSide = useCallback(() => {
    const next = !getSidebarSnapshot();
    applySidebar(next, document.documentElement);
    writeSidebarCollapsed(getBrowserStorage(), next);
  }, []);

  return (
    <div className={styles.panes} data-panes="">
      <button
        type="button"
        className={styles.sideToggle}
        onClick={toggleSide}
        aria-expanded={!sideCollapsed}
        aria-controls="side-repos"
        aria-label={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
        title={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
      >
        <PanelLeftIcon />
      </button>
      <div className={styles.side} id="side-repos" inert={sideCollapsed}>
        <SideRepos {...nav} />
      </div>
      <main id="main" className={styles.main}>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>すべてのリポジトリ</h1>
          <Link href={`${basePath}/setup`} className={styles.setup}>
            <PlusIcon />
            Setup
          </Link>
        </div>
        <div className={styles.totalRow}>
          <p className={`${styles.total} num`}>監視中 {rows.length}件</p>
          <CountsKey className={styles.keyMobile} />
        </div>
        <div className={styles.table}>
        <div className={styles.head} aria-hidden="true">
          <span />
          <CountsKey className={styles.keyHead} />
          <span>最後の動き</span>
          <span />
        </div>
        <ul className={styles.list}>
          {sorted.map((row) => (
            <li key={`${row.owner}/${row.repo}`} className={styles.row}>
              <Link href={`${basePath}/repos/${row.owner}/${row.repo}`} className={styles.name} title={`${row.owner}/${row.repo}`}>
                {row.repo}
              </Link>
              <Counts turn={row.turn} running={row.running} labeled={false} />
              <span className={`${styles.time} num`}>{formatLastActivity(row.lastAt, at)}</span>
              <span className={styles.links}>
                <a href={row.githubUrl} target="_blank" rel="noreferrer">
                  GitHub ↗
                </a>
                {row.links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                    {link.label} ↗
                  </a>
                ))}
              </span>
            </li>
          ))}
        </ul>
        </div>
        <Link href={`${basePath}/settings`} className={styles.settings}>
          設定で監視するリポジトリを変える
        </Link>
      </main>
    </div>
  );
}
