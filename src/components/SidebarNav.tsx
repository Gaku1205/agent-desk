"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { TurnCounts } from "@/lib/turn";
import { FileIcon, HomeIcon } from "./icons";

type Props = {
  repos: { owner: string; repo: string }[];
  /** 各ページの「あなたの番」の件数 */
  counts: TurnCounts;
};

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
