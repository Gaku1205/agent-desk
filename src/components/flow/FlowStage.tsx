"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { stripColumns } from "@/lib/flow/layout";
import { isNavKey, nextByArrow, pickTabStop, type NavBox } from "@/lib/flow/navigate";
import { countByStage, type FlowNode, type FlowWho } from "@/lib/flow/nodes";
import { isMotionReduced } from "@/lib/motion";
import { PROGRESS_STAGE_NAMES } from "@/lib/progress";
import { CLUSTER_KEY, FlowEngine, WHO_CSS } from "./engine";
import styles from "./FlowStage.module.css";

const MOBILE_MAX = 899;

/** 今、動きを止める設定か（端末の設定と `data-motion`） */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return true;
  return isMotionReduced(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    document.documentElement.getAttribute("data-motion"),
  );
}

function isMobile(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= MOBILE_MAX;
}

type Caption = { key: string; pinned: boolean } | null;

/** 色の凡例（流れの下端の右） */
const LEGEND: { who: FlowWho; label: string }[] = [
  { who: "human", label: "あなたの番" },
  { who: "ai", label: "AIの番" },
  { who: "queue", label: "待機" },
  { who: "fail", label: "失敗" },
  { who: "done", label: "公開済み" },
];

/**
 * 名札（または帯の列）の入れ物の中で、Tab で止まる物を1つにする（ほかは tabindex=-1）。
 * 見えている物（`data-off` でない）の中から、最後にフォーカスした物か、無ければ先頭の物
 */
function syncTabStop(root: HTMLElement | null, keyOf: (el: HTMLElement) => string, preferred: string | null) {
  if (!root) return;
  const els = [...root.querySelectorAll<HTMLElement>("button")];
  const keys = els.map(keyOf);
  const visible = new Set(els.filter((el) => !el.hasAttribute("data-off")).map(keyOf));
  const stop = pickTabStop(keys, visible, preferred);
  for (const el of els) el.tabIndex = keyOf(el) === stop ? 0 : -1;
}

/** 矢印キー・Home・End で、見えている物の中を動く（動いたら true） */
function arrowMove(root: HTMLElement, event: React.KeyboardEvent<HTMLElement>, keyOf: (el: HTMLElement) => string): void {
  if (!isNavKey(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const from = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
  if (!from || !root.contains(from)) return;
  const els = [...root.querySelectorAll<HTMLElement>("button")].filter((el) => !el.hasAttribute("data-off"));
  const boxes: NavBox[] = els.map((el) => {
    const r = el.getBoundingClientRect();
    return { key: keyOf(el), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  event.preventDefault();
  const next = nextByArrow(boxes, keyOf(from), event.key);
  if (next === null) return;
  els.find((el) => keyOf(el) === next)?.focus();
}

const nodeKeyOf = (el: HTMLElement): string => el.dataset.key ?? "";
const colKeyOf = (el: HTMLElement): string => el.dataset.at ?? "";

type Props = {
  nodes: FlowNode[];
  /** 流れを置く（ホーム・リポジトリのページ）。設定などでは false で、川だけ描く */
  stage: boolean;
  engineRef: MutableRefObject<FlowEngine | null>;
  /** すりガラスの帯（この上端より下は粒を暗くする） */
  bandRef: RefObject<HTMLElement | null>;
  /** 名札を押したとき：その Issue の行へ */
  onPick?: (key: string) => void;
};

/**
 * 流れ：画面全体の川（canvas）と、段階の列に浮かぶ Issue の光と名札。
 * 映像の計算は flow/engine.ts。ここは要素を用意して、データが変わるたびに渡す
 */
export function FlowStage({ nodes, stage, engineRef, bandRef, onPick }: Props) {
  const riverRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<HTMLElement>(null);
  const nodesRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef(new Map<string, HTMLElement>());
  const [caption, setCaption] = useState<Caption>(null);
  const [stripOpen, setStripOpen] = useState<number | null>(null);
  const firstRef = useRef(true);
  // Tab で止まる物（最後にフォーカスした名札・列）
  const nodeStopRef = useRef<string | null>(null);
  const colStopRef = useRef<string | null>(null);

  useEffect(() => {
    const river = riverRef.current;
    if (!river) return;
    const engine = new FlowEngine(
      { river, fog: document.body, flow: flowRef.current, nodes: nodesRef.current, band: bandRef.current },
      {
        isReduced: motionReduced,
        isMobile,
        labelFontSize: () => parseFloat(nodesRef.current ? getComputedStyle(nodesRef.current).fontSize : "12") || 12,
        stripCenters: () => {
          const strip = stripRef.current;
          if (!strip) return null;
          const base = strip.getBoundingClientRect();
          return [...strip.querySelectorAll<HTMLElement>("[data-at]")].map((el) => {
            const r = el.getBoundingClientRect();
            return r.left - base.left + r.width / 2;
          });
        },
      },
    );
    for (const [key, el] of labelsRef.current) engine.setLabel(key, el);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [engineRef, bandRef]);

  useEffect(() => {
    engineRef.current?.setNodes(nodes, !firstRef.current);
    firstRef.current = false;
  }, [nodes, engineRef]);

  // 名札は全部で1つの停止点。エンジンが名札を出し入れ（data-off）するたびに、見えている物から選び直す
  useEffect(() => {
    const root = nodesRef.current;
    if (!root) return;
    const sync = () => syncTabStop(root, nodeKeyOf, nodeStopRef.current);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-off"] });
    return () => observer.disconnect();
  }, [nodes, stage]);

  // スマホの帯の8つの列も、全部で1つの停止点
  useEffect(() => {
    syncTabStop(stripRef.current, colKeyOf, colStopRef.current);
  }, [nodes, stage]);

  const register = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) labelsRef.current.set(key, el);
      else labelsRef.current.delete(key);
      engineRef.current?.setLabel(key, el);
    },
    [engineRef],
  );

  useEffect(() => {
    if (!caption?.pinned) return;
    function onDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(`.${styles.node}, .${styles.caption}, .${styles.col}`)) return;
      setCaption(null);
      setStripOpen(null);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [caption]);

  const counts = countByStage(nodes);
  const multiRepo = new Set(nodes.map((n) => `${n.owner}/${n.repo}`)).size > 1;
  const current = caption ? (nodes.find((n) => n.key === caption.key) ?? null) : null;
  const columns = stripColumns(nodes);
  // 公開済みは右端の1つの塊（いちばん新しい物＝並びの先頭）
  const done = nodes.filter((n) => n.who === "done");
  const latest = done[0] ?? null;
  const clusterOn = caption?.key === CLUSTER_KEY && latest !== null;

  function show(key: string, pinned: boolean) {
    setCaption((prev) => (prev?.pinned && !pinned ? prev : { key, pinned }));
  }
  function hide() {
    setCaption((prev) => (prev?.pinned ? prev : null));
  }

  return (
    <>
      <canvas ref={riverRef} className={`${styles.layer} ${styles.river}`} aria-hidden="true" />
      {stage && (
        <div className={styles.wrap}>
        <section ref={flowRef} className={styles.flow} aria-label="パイプラインの流れ">
          <div className={styles.stages} aria-hidden="true">
            {PROGRESS_STAGE_NAMES.map((name, k) => (
              <span key={name}>
                {name}
                <i className="num">{counts[k] || ""}</i>
              </span>
            ))}
          </div>
          <div
            ref={stripRef}
            className={styles.strip}
            role="group"
            aria-label="段階ごとの件数（左右の矢印キーで移動）"
            onKeyDown={(event) => stripRef.current && arrowMove(stripRef.current, event, colKeyOf)}
          >
            {columns.map((column) => (
              <button
                key={column.at}
                type="button"
                className={styles.col}
                data-at={column.at}
                aria-expanded={stripOpen === column.at}
                aria-label={`${PROGRESS_STAGE_NAMES[column.at]} ${column.count}件`}
                tabIndex={-1}
                onFocus={() => {
                  colStopRef.current = String(column.at);
                  syncTabStop(stripRef.current, colKeyOf, colStopRef.current);
                }}
                onClick={() => {
                  const next = stripOpen === column.at ? null : column.at;
                  setStripOpen(next);
                  setCaption(null);
                  engineRef.current?.highlightStrip(next ?? -1);
                }}
              >
                <span className={styles.colName}>{PROGRESS_STAGE_NAMES[column.at]}</span>
                <span className={`${styles.colCount} num`} data-zero={column.count === 0 ? "" : undefined}>
                  {column.count || "·"}
                </span>
              </button>
            ))}
          </div>
          <div
            ref={nodesRef}
            className={styles.nodes}
            role="group"
            aria-label="Issueの名札（矢印キーで移動）"
            onKeyDown={(event) => nodesRef.current && arrowMove(nodesRef.current, event, nodeKeyOf)}
          >
            {nodes.map((node) => (
              <button
                key={node.key}
                ref={register(node.key)}
                type="button"
                className={styles.node}
                data-key={node.key}
                data-off=""
                data-urgent={node.urgent ? "" : undefined}
                data-pinned={caption?.pinned && caption.key === node.key ? "" : undefined}
                tabIndex={-1}
                style={{ "--c": WHO_CSS[node.who] } as React.CSSProperties}
                aria-label={`${node.repo}#${node.number} ${node.title}。${node.label}`}
                onMouseEnter={() => show(node.key, false)}
                onMouseLeave={hide}
                onFocus={() => {
                  nodeStopRef.current = node.key;
                  syncTabStop(nodesRef.current, nodeKeyOf, node.key);
                  show(node.key, false);
                }}
                onBlur={hide}
                onClick={() => {
                  show(node.key, true);
                  onPick?.(node.key);
                }}
              >
                <span className={styles.tag} aria-hidden="true">
                  <span className={styles.l1}>
                    <span className={`${styles.id} num`}>
                      {multiRepo ? node.repo : ""}#{node.number}
                    </span>
                    <span className={styles.st}>{node.label}</span>
                  </span>
                  <span className={styles.l2}>
                    <span className={styles.tt}>{node.title}</span>
                    <span className={styles.st2}>{node.label}</span>
                  </span>
                </span>
              </button>
            ))}
            {latest && (
              <button
                ref={register(CLUSTER_KEY)}
                type="button"
                className={styles.node}
                data-key={CLUSTER_KEY}
                data-off=""
                data-cluster=""
                data-pinned={caption?.pinned && caption.key === CLUSTER_KEY ? "" : undefined}
                tabIndex={-1}
                style={{ "--c": WHO_CSS.done } as React.CSSProperties}
                aria-label={`公開済み ${done.length}件（いちばん新しい物：${latest.repo}#${latest.number} ${latest.title}）`}
                onMouseEnter={() => show(CLUSTER_KEY, false)}
                onMouseLeave={hide}
                onFocus={() => {
                  nodeStopRef.current = CLUSTER_KEY;
                  syncTabStop(nodesRef.current, nodeKeyOf, CLUSTER_KEY);
                  show(CLUSTER_KEY, false);
                }}
                onBlur={hide}
                onClick={() => show(CLUSTER_KEY, true)}
              >
                <span className={styles.tag} aria-hidden="true">
                  <span className={styles.l1}>
                    <span className={styles.st}>公開済み</span>
                    <span className={`${styles.id} num`}>{done.length}件</span>
                  </span>
                  <span className={styles.l2}>
                    <span className={styles.tt}>{latest.title} ほか</span>
                    <span className={styles.st2}>公開済み</span>
                  </span>
                </span>
              </button>
            )}
          </div>
        </section>
          <div className={styles.foot}>
            <p
              className={styles.caption}
              data-on={current || clusterOn || stripOpen !== null ? "" : undefined}
              data-pinned={caption?.pinned || stripOpen !== null ? "" : undefined}
              aria-live="polite"
              style={
                {
                  // 強い色は急ぐ物（止まった・公開失敗）だけ
                  "--c": current?.urgent ? WHO_CSS[current.who] : undefined,
                } as React.CSSProperties
              }
            >
              {stripOpen !== null ? (
                <StripCaption nodes={nodes.filter((n) => n.at === stripOpen)} onPick={onPick} />
              ) : clusterOn && latest ? (
                <>
                  <b>公開済み</b>
                  <span className={`${styles.capId} num`}>{done.length}件</span>
                  <span className={`${styles.capId} num`}>
                    {latest.repo}#{latest.number}
                  </span>
                  <span className={styles.capText}>{latest.title}</span>
                  {latest.deployLinks.map((link) => (
                    <a key={link.url} className={styles.capLink} href={link.url} target="_blank" rel="noreferrer">
                      {link.label} ↗
                    </a>
                  ))}
                </>
              ) : current ? (
                <>
                  <span className={`${styles.capId} num`}>
                    {current.repo}#{current.number}
                  </span>
                  <b>{current.label}</b>
                  <span className={styles.capText}>{current.caption}</span>
                  {current.logUrl && (
                    <a className={styles.capLink} href={current.logUrl} target="_blank" rel="noreferrer">
                      ログを開く ↗
                    </a>
                  )}
                  {current.deployLinks.map((link) => (
                    <a key={link.url} className={styles.capLink} href={link.url} target="_blank" rel="noreferrer">
                      {link.label} ↗
                    </a>
                  ))}
                </>
              ) : null}
            </p>
            <ul className={styles.legend} aria-hidden="true">
              {LEGEND.map(({ who, label }) => (
                <li key={who} style={{ "--c": WHO_CSS[who] } as React.CSSProperties}>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

/** スマホの帯で列を押したとき：その段階の Issue を1行ずつ */
function StripCaption({ nodes, onPick }: { nodes: FlowNode[]; onPick?: (key: string) => void }) {
  if (nodes.length === 0) return <span className={styles.capText}>この段階の作業はありません</span>;
  const multi = new Set(nodes.map((n) => `${n.owner}/${n.repo}`)).size > 1;
  return (
    <span className={styles.stripList}>
      {nodes.map((node) => (
        <button
          key={node.key}
          type="button"
          className={styles.stripItem}
          style={{ "--c": WHO_CSS[node.who] } as React.CSSProperties}
          onClick={() => onPick?.(node.key)}
        >
          <span className={`${styles.id} num`}>
            {multi ? node.repo : ""}#{node.number}
          </span>
          <b>{node.label}</b>
          <span className={styles.stripTitle}>{node.title}</span>
        </button>
      ))}
    </span>
  );
}
