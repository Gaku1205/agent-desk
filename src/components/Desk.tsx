"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrailEvent } from "@/lib/events";
import type { FlowNode } from "@/lib/flow/nodes";
import { repoBreakdown } from "@/lib/breakdown";
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
  const rowsRef = useRef<HTMLDivElement>(null);
  const giantRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const unitRef = useRef<HTMLSpanElement>(null);
  const turnsRef = useRef<HTMLElement>(null);
  // 操作が通って畳んでいる行。取り直しを待たずに数字を減らす（取り直しで行が消えたら自然に数えなくなる）
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const count = items.filter((item) => !leaving.has(turnItemKey(item))).length;

  useEffect(() => {
    const engine = engineRef.current;
    const canvas = giantRef.current;
    const ghost = ghostRef.current;
    if (!engine || !canvas || !ghost) return;
    // 灯った粒を見せてよい右端：PC は押す列の左端の10px手前、スマホは「件」の右端の6px先（右隣の見出しの手前）
    const litEdge = () => {
      const turns = turnsRef.current;
      const unit = unitRef.current;
      if (window.innerWidth <= 899) return unit ? unit.getBoundingClientRect().right + 6 : 0;
      return turns ? turns.getBoundingClientRect().left - 10 : innerWidth;
    };
    engine.setGiant({ canvas, ghost, litEdge });
    return () => engine.setGiant(null);
  }, []);

  useEffect(() => {
    engineRef.current?.setGiantValue(count);
  }, [count]);

  const hover = useCallback((key: string | null) => engineRef.current?.highlight(key), []);
  const press =useCallback((key: string, column: number) => engineRef.current?.fly(key, column), []);
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
  // 流れの名札・スマホの帯の行を押したとき：押す列の、その Issue の行へ。
  // 流れの名札も同じ data-key を持つので、探すのは押す列の中だけにする（名札に当たらないように）
  const pick = useCallback((key: string) => {
    const row = rowsRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: motionReduced() ? "auto" : "smooth" });
    // 最初のボタン。ボタンが無い行（パイプライン未設定の未着手など）は題名のリンク
    (row.querySelector<HTMLElement>('[data-act]:not([aria-disabled="true"])') ?? row.querySelector<HTMLElement>("a, button"))?.focus({
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
          <span className={styles.unit} ref={unitRef} aria-hidden="true">
            件
          </span>
          <h1 className={styles.h1} id="turn-title" tabIndex={-1}>
            あなたの番
            <small>{count > 0 ? "待ちが長い順" : "今はAIの番です"}</small>
          </h1>
          {scope.kind === "all" && <RepoBreakdown repos={scope.repos} />}
          <p className={styles.split} data-scope={scope.kind}>
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
        <section className={styles.turns} ref={turnsRef} aria-labelledby="turn-title" data-skip-target="">
          <div className={styles.rows} ref={rowsRef}>
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

/**
 * リポジトリごとの内訳（ホームの PC）：件数の多い順に、数の大きさの差で見せる（docs/design.md の「巨大な数字」）。
 * 読み上げは下の1行（スマホで見せる物。PC では見た目だけ隠す）と同じ中身なので、ここは aria-hidden
 */
function RepoBreakdown({ repos }: { repos: { repo: string; count: number }[] }) {
  const sorted = repoBreakdown(repos);
  return (
    <ul className={styles.breakdown} aria-hidden="true">
      {sorted.map(({ repo, count, size }) => (
        <li key={repo} data-zero={count === 0 ? "" : undefined}>
          <b className="num" style={{ fontSize: `${size}px` }}>
            {count}
          </b>
          <span>{repo}</span>
        </li>
      ))}
    </ul>
  );
}
