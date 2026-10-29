import Link from "next/link";
import type { ReactNode } from "react";
import { isExternalUrl } from "@/lib/externalUrl";

type Props = {
  href: string;
  className?: string;
  children: ReactNode;
  /** ボタンの印（キーボードの移動先を探すのに使う） */
  "data-act"?: string;
};

/**
 * リンク：外のサイト（https://）だけ新しいタブで開き、アプリの中のページは同じタブで開く
 * （docs/design.md の「方針」）
 */
export function SmartLink({ href, className, children, ...rest }: Props) {
  if (isExternalUrl(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}
