import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, IBM_Plex_Sans_JP } from "next/font/google";
import { MENU_PRE_TAP_SCRIPT } from "@/lib/menuPreTap";
import { MOTION_INIT_SCRIPT } from "@/lib/motion";
import { SIDEBAR_INIT_SCRIPT } from "@/lib/sidebar";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

/**
 * 和文：IBM Plex Sans JP（docs/design.md の「文字」）。
 * 先読み（preload）はしない：日本語のフォントは細かく分かれたファイル（1つの太さで100個以上）で配られ、先読みを有効にすると、
 * そのページで使わない分まで全部（本番で woff2 247個・2.8MB）を、開くたびに最初の描画の前から読みに行っていた。
 * 先読みしなければ、ブラウザが画面の文字に要る分だけを読み、読めるまでは代わりの字で先に出す（`display: "swap"`）
 */
const plexSansJp = IBM_Plex_Sans_JP({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: "--font-jp",
  display: "swap",
  preload: false,
});

/** 欧文・数字：Geist（可変） */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-latin",
  display: "swap",
});

/** ワードマーク：Bricolage Grotesque 800（opsz 96） */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-disp",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "agent-desk", template: "%s · agent-desk" },
  description: "AIに開発を任せるときの進行状況と、人間の判断待ちを1画面で",
};

/** スマホのアドレスバーの色：藍（`--accent` のライトの値）の1色。ダークでも同じ。CSS変数が使えないので、ここだけ直書き */
export const viewport: Viewport = {
  themeColor: "#4f46e5",
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
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: MENU_PRE_TAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
