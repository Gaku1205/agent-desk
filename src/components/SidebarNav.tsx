"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileIcon, HomeIcon } from "./icons";

type Props = {
  repos: { owner: string; repo: string }[];
};

export function SidebarNav({ repos }: Props) {
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
      </Link>

      <p className="sidebar-heading">リポジトリ</p>
      {repos.map(({ owner, repo }) => {
        const href = `/repos/${owner}/${repo}`;
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
          </Link>
        );
      })}
    </nav>
  );
}
