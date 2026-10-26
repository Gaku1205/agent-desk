import type { Metadata } from "next";
import { IBM_Plex_Sans_JP, JetBrains_Mono } from "next/font/google";
import { MOTION_INIT_SCRIPT } from "@/lib/motion";
import "./globals.css";

const plexSansJp = IBM_Plex_Sans_JP({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
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
      className={`${plexSansJp.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
