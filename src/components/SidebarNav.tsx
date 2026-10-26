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

export function SidebarNav({ repos, counts, basePath = "" }: Props) {
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
        <span className={`${styles.count} mono`}>{counts.total}</span>
      </Link>

      <p className={styles.heading}>リポジトリ</p>
      {repos.map(({ owner, repo }) => {
        const href = `${basePath}/repos/${owner}/${repo}`;
        const count = counts.byRepo[`${owner}/${repo}`.toLowerCase()] ?? 0;
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
            {count > 0 && <span className={`${styles.count} mono`}>{count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
