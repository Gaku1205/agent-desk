"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TrailEvent } from "@/lib/events";
import type { FlowNode } from "@/lib/flow/nodes";
import { formatWait, type TurnItem } from "@/lib/turn";
import type { WatchdogNotice } from "@/lib/watchdogState";
import styles from "./Desk.module.css";
import type { FlowEngine } from "./flow/engine";
import { WHO_CSS } from "./flow/engine";
import { FlowStage, motionReduced } from "./flow/FlowStage";
import { Trails } from "./Trails";
import { TurnRow } from "./TurnRow";

export type DeskScope =
  | { kind: "all"; repos: { repo: string; count: number }[] }
  | { kind: "repo"; owner: string; repo: string; githubUrl: string | null };

export type DeskError = { repo: string; message: string };

type Props = {
  nodes: FlowNode[];
  items: TurnItem[];
  events: TrailEvent[];
  /** 「今」（ISO文字列） */
  now: string;
  scope: DeskScope;
  /** 取れなかったリポジトリ */
  errors: DeskError[];
  /** 見張り役が止まっているリポジトリ */
  notices: WatchdogNotice[];
};

const LEGEND: { who: keyof typeof WHO_CSS; label: string }[] = [
  { who: "human", label: "あなたの番" },
  { who: "ai", label: "AIの番" },
  { who: "queue", label: "待機" },
  { who: "fail", label: "失敗" },
  { who: "done", label: "公開済み" },
];

/**
 * ホームとリポジトリのページの中身：上に流れ、下にすりガラスの誌面
 * （巨大な数字 ＋ 押す列 ＋ 出来事）。本物もデモも同じ物（docs/design.md）
 */
export function Desk({ nodes, items, events, now, scope, errors, notices }: Props) {
  const engineRef = useRef<FlowEngine | null>(null);
  const bandRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const giantRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const count = items.length;

  useEffect(() => {
    const engine = engineRef.current;
    const canvas = giantRef.current;
    const ghost = ghostRef.current;
    if (!engine || !canvas || !ghost) return;
    engine.setGiant({ canvas, ghost });
    return () => engine.setGiant(null);
  }, []);

  useEffect(() => {
    engineRef.current?.setGiantValue(count);
  }, [count]);

  const hover = useCallback((key: string | null) => engineRef.current?.highlight(key), []);
  const press = useCallback((key: string) => engineRef.current?.kick(key), []);
  // 流れの名札・スマホの帯の行を押したとき：押す列の、その Issue の行へ。
  // 流れの名札も同じ data-key を持つので、探すのは押す列の中だけにする（名札に当たらないように）
  const pick = useCallback((key: string) => {
    const row = rowsRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: motionReduced() ? "auto" : "smooth" });
    // 最初のボタン。ボタンが無い行（パイプライン未設定の未着手など）は題名のリンク
    (row.querySelector<HTMLElement>("[data-act]:not(:disabled)") ?? row.querySelector<HTMLElement>("a, button"))?.focus({
      preventScroll: true,
    });
    row.setAttribute("data-picked", "");
    window.setTimeout(() => row.removeAttribute("data-picked"), 1600);
  }, []);

  return (
    <>
      <FlowStage nodes={nodes} stage engineRef={engineRef} bandRef={bandRef} onPick={pick} />
      <main className={styles.band} ref={bandRef} id="main">
        <div className={styles.hero}>
          <div className={styles.giant} role="img" aria-label={`あなたの番 ${count}件`}>
            <canvas ref={giantRef} />
            <span className={styles.ghost} ref={ghostRef} aria-hidden="true">
              {count}
            </span>
          </div>
          <span className={styles.unit} aria-hidden="true">
            件
          </span>
          <h1 className={styles.h1} id="turn-title">
            あなたの番
            <small>{count > 0 ? "待ちが長い順" : "今はAIの番です"}</small>
          </h1>
          <p className={styles.split}>
            {scope.kind === "all" ? (
              scope.repos.map(({ repo, count: n }) => (
                <span key={repo} className={styles.splitItem}>
                  {repo} <b className="num">{n}</b>
                </span>
              ))
            ) : (
              <>
                <span className={styles.splitItem}>{scope.repo} だけ</span>
                {scope.githubUrl && (
                  <a className={styles.splitLink} href={scope.githubUrl} target="_blank" rel="noreferrer">
                    GitHubで開く ↗
                  </a>
                )}
              </>
            )}
          </p>
          <ul className={styles.legend} aria-hidden="true">
            {LEGEND.map(({ who, label }) => (
              <li key={who} style={{ "--c": WHO_CSS[who] } as React.CSSProperties}>
                {label}
              </li>
            ))}
          </ul>
          {notices.length > 0 && (
            <ul className={styles.notices} role="status">
              {notices.map((notice) => (
                <li key={`${notice.owner}/${notice.repo}`}>
                  {scope.kind === "all" && <span className="num">{notice.repo}　</span>}
                  見張り役が {notice.hours} 時間動いていません。Actions が止まっていないか確認してください
                </li>
              ))}
            </ul>
          )}
          {errors.length > 0 && (
            <ul className={styles.errors}>
              {errors.map((error) => (
                <li key={error.repo}>
                  <span className="num">{error.repo}</span>：{error.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        <section className={styles.turns} aria-labelledby="turn-title" data-skip-target="">
          <div className={styles.rows} ref={rowsRef}>
            {items.length === 0 ? (
              <p className="empty">今はAIの番です。流れの上で光が進んでいます</p>
            ) : (
              items.map((item) => (
                <TurnRow
                  key={`${item.owner}/${item.repo}#${item.issue.number}`}
                  item={item}
                  wait={formatWait(item.waitingSince, new Date(now))}
                  onHover={hover}
                  onPress={press}
                />
              ))
            )}
          </div>
        </section>
        <Trails events={events} now={now} hint={scope.kind === "all" ? "直近3日" : "直近3日・このリポジトリ"} />
      </main>
    </>
  );
}
