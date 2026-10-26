"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TurnCounts } from "@/lib/turn";
import { FileIcon, GearIcon, HomeIcon } from "./icons";

type Props = {
  repos: { owner: string; repo: string }[];
  /** 各ページの「あなたの番」の件数 */
  counts: TurnCounts;
};

/** サイドバーの下のまとまり（同期・更新）の上に置く「設定」へのリンク */
export function SettingsLink() {
  const pathname = usePathname();

  return (
    <nav aria-label="設定" className="sidebar-settings">
      <Link
        href="/settings"
        className="sidebar-item"
        aria-current={pathname.toLowerCase() === "/settings" ? "page" : undefined}
      >
        <GearIcon />
        <span className="sidebar-item-label">設定</span>
      </Link>
    </nav>
  );
}

export function SidebarNav({ repos, counts }: Props) {
  const pathname = usePathname();
  const isCurrent = (href: string) =>
    pathname.toLowerCase() === href.toLowerCase();

  return (
    <nav aria-label="リポジトリ" className="sidebar-nav">
      <Link
        href="/"
        className="sidebar-item"
        aria-current={isCurrent("/") ? "page" : undefined}
      >
        <HomeIcon />
        <span className="sidebar-item-label">ホーム</span>
        <span className="sidebar-count mono">{counts.total}</span>
      </Link>

      <p className="sidebar-heading">リポジトリ</p>
      {repos.map(({ owner, repo }) => {
        const href = `/repos/${owner}/${repo}`;
        const count = counts.byRepo[`${owner}/${repo}`.toLowerCase()] ?? 0;
        return (
          <Link
            key={href}
            href={href}
            className="sidebar-item sidebar-repo"
            aria-current={isCurrent(href) ? "page" : undefined}
            title={`${owner}/${repo}`}
          >
            <FileIcon />
            <span className="sidebar-item-label mono">{repo}</span>
            {count > 0 && <span className="sidebar-count mono">{count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
