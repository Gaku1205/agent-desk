"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildDemoResults } from "@/lib/demo/data";
import {
  advancePlayback,
  isPlaybackDone,
  PLAY_INTERVAL_MS,
  restartPlayback,
  startPlayback,
  type PlayButtonState,
} from "@/lib/demo/playback";
import { buildTurnItems } from "@/lib/turn";
import { ShellProvider, useMenuState, type ShellState } from "./AppShell";
import { DemoProvider, type DemoState } from "./DemoContext";
import styles from "./DemoShell.module.css";

/** 「デモでは実際には動きません」を出しておく長さ */
const NOTICE_MS = 2000;

/**
 * デモの画面全体。サンプルのデータと再生の状態を持ち、本物と同じ部品に渡す。
 * GitHub には問い合わせず、自動更新もしない（再生の間だけ画面が変わる）
 */
export function DemoShell({
  initialNow,
  children,
}: {
  /** サーバーが決めたデモの「今」（ISO文字列。`DEMO_NOW` があればその時刻） */
  initialNow: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [base] = useState(() => new Date(initialNow));
  const [playback, setPlayback] = useState(() => startPlayback(base));
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState(0);
  // 段階が進んだ回数を、本物の「取り直しが終わった回数」と同じように数える（新しく入った行のフェードイン用）
  const [seen, setSeen] = useState({ step: playback.step, pathname, count: 0 });
  const { menuOpen, openMenu, closeMenu } = useMenuState();

  if (seen.step !== playback.step) {
    setSeen({
      step: playback.step,
      pathname,
      count: seen.pathname === pathname ? seen.count + 1 : 1,
    });
  }
  if (playing && isPlaybackDone(playback)) setPlaying(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPlayback(advancePlayback), PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (notice === 0) return;
    const timer = window.setTimeout(() => setNotice(0), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const notify = useCallback(() => setNotice((n) => n + 1), []);
  const play = useCallback(() => {
    if (playing) return;
    if (isPlaybackDone(playback)) setPlayback(restartPlayback(playback));
    setPlaying(true);
  }, [playing, playback]);

  const playState: PlayButtonState = playing
    ? "playing"
    : isPlaybackDone(playback)
      ? "done"
      : "idle";

  const demo = useMemo<DemoState>(() => {
    const now = new Date(playback.now);
    const results = buildDemoResults(base, playback);
    return { results, items: buildTurnItems(results, now), now, playState, play, notify };
  }, [base, playback, playState, play, notify]);

  const shell = useMemo<ShellState>(
    () => ({
      syncedAt: demo.now,
      refreshing: false,
      fastRefresh: false,
      pausedUntil: null,
      // デモは自動更新をしない
      // 取り直す物が無いので、押しても動かないことを知らせる
      refresh: notify,
      refreshCountOnPage: seen.pathname === pathname ? seen.count : 0,
      menuOpen,
      openMenu,
      closeMenu,
    }),
    [demo.now, notify, seen, pathname, menuOpen, openMenu, closeMenu],
  );

  return (
    <ShellProvider value={shell}>
      <DemoProvider value={demo}>
        {children}
        {notice > 0 && (
          <p className={styles.notice} role="status" key={notice}>
            デモでは実際には動きません
          </p>
        )}
      </DemoProvider>
    </ShellProvider>
  );
}
