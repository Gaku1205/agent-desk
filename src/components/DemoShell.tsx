"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildAddedNotices } from "@/lib/autoAdd";
import {
  buildDemoResults,
  createDemoIssue,
  DEMO_AUTO_ADD_REPO,
  DEMO_REPOS,
  demoAutoAdd,
  demoAutoAddResult,
  pressDemo,
} from "@/lib/demo/data";
import { DEMO_OP_DELAY_MS } from "@/lib/demo/ops";
import {
  advancePlayback,
  isPlaybackDone,
  PLAY_INTERVAL_MS,
  restartPlayback,
  startPlayback,
  type PlayButtonState,
} from "@/lib/demo/playback";
import {
  formatParallelOverride,
  planParallelToggle,
  resolveParallelState,
  type ParallelSettings,
} from "@/lib/parallel";
import { buildTurnItems, type OperationKind } from "@/lib/turn";
import { ShellProvider, useMenuState, type ShellState } from "./AppShell";
import { DemoProvider, type DemoState } from "./DemoContext";
import { KeyboardHelp } from "./KeyboardHelp";
import { ParallelViewProvider, type ParallelView } from "./ParallelContext";
import styles from "./DemoShell.module.css";

/** デモの並列の設定（昼3・夜1・夜は1時〜8時） */
const DEMO_PARALLEL_SETTINGS: ParallelSettings = { day: 3, night: 1, nightHours: { start: 1, end: 8 } };

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
  const operate = useCallback(
    (target: { owner: string; repo: string; number: number }, kind: OperationKind, answer?: string) => {
      window.setTimeout(() => setPlayback((prev) => pressDemo(prev, target, kind, answer)), DEMO_OP_DELAY_MS);
    },
    [],
  );
  const createIssue = useCallback(
    (target: { owner: string; repo: string }, issue: { title: string; body: string }) => {
      setPlayback((prev) => createDemoIssue(prev, target, issue));
    },
    [],
  );
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

  // 工場が「作る」で作ったリポジトリを、自動で監視に足す（設定がオンのとき。一度足した物は、オフにしても外さない）
  const [autoAdd, setAutoAdd] = useState(true);
  const [keptAt, setKeptAt] = useState<string | null>(null);
  const baseResults = useMemo(() => buildDemoResults(base, playback), [base, playback]);
  const olderResults = useMemo(() => buildDemoResults(base, playback, true), [base, playback]);
  const possible = demoAutoAdd(baseResults, true);
  const addedAt = possible && (autoAdd || keptAt === possible.at) ? possible.at : null;
  if (addedAt && keptAt !== addedAt) setKeptAt(addedAt);

  const demo = useMemo<DemoState>(() => {
    const now = new Date(playback.now);
    const results = addedAt ? [...baseResults, demoAutoAddResult(addedAt)] : baseResults;
    const repos = addedAt ? [...DEMO_REPOS, DEMO_AUTO_ADD_REPO] : DEMO_REPOS;
    const addedNotices = buildAddedNotices(
      addedAt ? [{ repo: `${DEMO_AUTO_ADD_REPO.owner}/${DEMO_AUTO_ADD_REPO.repo}`, at: addedAt }] : [],
      repos,
      now,
    );
    return {
      results,
      dashboardResults: addedAt ? [...olderResults, demoAutoAddResult(addedAt)] : olderResults,
      repos,
      addedNotices,
      autoAdd,
      setAutoAdd,
      items: buildTurnItems(results, now),
      now,
      playState,
      play,
      notify,
      operate,
      createIssue,
    };
  }, [baseResults, olderResults, addedAt, autoAdd, playback.now, playState, play, notify, operate, createIssue]);

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

  // 並列の状態のボタン：見た目と切り替えだけ動かす（GitHubには書かない）。「今」はデモの時刻
  const [parallelOverride, setParallelOverride] = useState<string | null>(null);
  const parallel = useMemo<ParallelView>(
    () => ({
      state: resolveParallelState(demo.now, DEMO_PARALLEL_SETTINGS, parallelOverride),
      settings: DEMO_PARALLEL_SETTINGS,
      busy: false,
      error: null,
      toggle: () => {
        const plan = planParallelToggle(demo.now, DEMO_PARALLEL_SETTINGS, parallelOverride);
        setParallelOverride(plan.mode === "clear" ? null : formatParallelOverride(plan.override));
      },
    }),
    [demo.now, parallelOverride],
  );

  return (
    <ShellProvider value={shell}>
      <DemoProvider value={demo}>
        <ParallelViewProvider value={parallel}>
          {children}
          <KeyboardHelp />
          {notice > 0 && (
            <p className={styles.notice} role="status" key={notice}>
              デモでは実際には動きません
            </p>
          )}
        </ParallelViewProvider>
      </DemoProvider>
    </ShellProvider>
  );
}
