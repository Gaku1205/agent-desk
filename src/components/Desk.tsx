"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrailEvent } from "@/lib/events";
import type { FlowNode } from "@/lib/flow/nodes";
import { formatWait, turnItemKey, type TurnItem } from "@/lib/turn";
import type { WatchdogNotice } from "@/lib/watchdogState";
import styles from "./Desk.module.css";
import type { FlowEngine } from "./flow/engine";
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

/**
 * ホームとリポジトリのページの中身：上に流れ、下にすりガラスの誌面
 * （巨大な数字 ＋ 押す列 ＋ 出来事）。本物もデモも同じ物（docs/design.md）
 */
export function Desk({ nodes, items, events, now, scope, errors, notices }: Props) {
  const engineRef = useRef<FlowEngine | null>(null);
  const bandRef = useRef<HTMLElement>(null);
  const giantRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  // 操作が通って畳んでいる行。取り直しを待たずに数字を減らす（取り直しで行が消えたら自然に数えなくなる）
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const count = items.filter((item) => !leaving.has(turnItemKey(item))).length;

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
  const press = useCallback((key: string, column: number) => engineRef.current?.fly(key, column), []);
  const settle = useCallback((key: string, ok: boolean) => {
    if (!ok) engineRef.current?.land(key);
  }, []);
  const leave = useCallback((key: string, on: boolean) => {
    setLeaving((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const pick = useCallback((key: string) => {
    const row = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!row || !row.closest(`.${styles.rows}`)) return;
    row.scrollIntoView({ block: "center", behavior: motionReduced() ? "auto" : "smooth" });
    row.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <FlowStage nodes={nodes} stage engineRef={engineRef} bandRef={bandRef} onPick={pick} />
      <main className={styles.band} ref={bandRef}>
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
        <section className={styles.turns} aria-labelledby="turn-title">
          <div className={styles.rows}>
            {items.length === 0 ? (
              <p className="empty">今はAIの番です。流れの上で光が進んでいます</p>
            ) : (
              items.map((item) => (
                <TurnRow
                  key={turnItemKey(item)}
                  item={item}
                  wait={formatWait(item.waitingSince, new Date(now))}
                  onHover={hover}
                  onPress={press}
                  onSettle={settle}
                  onLeave={leave}
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
