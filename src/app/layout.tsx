import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, IBM_Plex_Sans_JP } from "next/font/google";
import { MOTION_INIT_SCRIPT } from "@/lib/motion";
import "./globals.css";

/** 和文：IBM Plex Sans JP（docs/design.md の「文字」） */
const plexSansJp = IBM_Plex_Sans_JP({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-jp",
  display: "swap",
});

/** 欧文・数字：Geist（可変） */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-latin",
  display: "swap",
});

/** 見出し・巨大な数字・ワードマーク：Bricolage Grotesque 800（opsz 96） */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-disp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "agent-desk",
  description: "AIに開発を任せるときの進行状況と、人間の判断待ちを1画面で",
};

/** 全ページ共通の骨組み。ログインの確認は (app)/layout.tsx、デモは demo/layout.tsx */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${plexSansJp.variable} ${geist.variable} ${bricolage.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
