import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "agent-desk",
  description: "AIに開発を任せるときの進行状況と、人間の判断待ちを1画面で",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
