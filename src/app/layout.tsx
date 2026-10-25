import type { Metadata } from "next";
import { IBM_Plex_Sans_JP, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { LoginScreen } from "@/components/LoginScreen";
import { Sidebar } from "@/components/Sidebar";
import { getSignedInLogin } from "@/lib/auth";
import { loadTurns } from "@/lib/loadTurns";
import { getRefreshIntervalMs } from "@/lib/refresh";
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const login = await getSignedInLogin();
  const loaded = login ? await loadTurns() : null;
  const syncedAt = loaded?.now ?? null;

  return (
    <html lang="ja" className={`${plexSansJp.variable} ${jetbrainsMono.variable}`}>
      <body>
        {login && syncedAt ? (
          <AppShell
            initialSyncedAt={syncedAt.toISOString()}
            refreshIntervalMs={getRefreshIntervalMs(loaded?.hasAiWork ?? false)}
          >
            <div className="app">
              <Sidebar login={login} />
              <div className="main">{children}</div>
            </div>
          </AppShell>
        ) : (
          <LoginScreen />
        )}
      </body>
    </html>
  );
}
