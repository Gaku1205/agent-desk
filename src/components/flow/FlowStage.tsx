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
import { countByStage, type FlowNode } from "@/lib/flow/nodes";
import { isMotionReduced } from "@/lib/motion";
import { PROGRESS_STAGE_NAMES } from "@/lib/progress";
import { FlowEngine, WHO_CSS } from "./engine";
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
  const fogRef = useRef<HTMLCanvasElement>(null);
  const riverRef = useRef<HTMLCanvasElement>(null);
  const flowRef = useRef<HTMLElement>(null);
  const nodesRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef(new Map<string, HTMLElement>());
  const [caption, setCaption] = useState<Caption>(null);
  const [stripOpen, setStripOpen] = useState<number | null>(null);
  const firstRef = useRef(true);

  useEffect(() => {
    const river = riverRef.current;
    const fog = fogRef.current;
    if (!river || !fog) return;
    const engine = new FlowEngine(
      { river, fog, flow: flowRef.current, nodes: nodesRef.current, band: bandRef.current },
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
  const dones = nodes.filter((n) => n.who === "done");
  const current = caption ? (caption.key === "cluster:deployed" ? clusterOf(dones) : nodes.find((n) => n.key === caption.key)) : null;
  const columns = stripColumns(nodes);

  function show(key: string, pinned: boolean) {
    setCaption((prev) => (prev?.pinned && !pinned ? prev : { key, pinned }));
  }
  function hide() {
    setCaption((prev) => (prev?.pinned ? prev : null));
  }

  return (
    <>
      <canvas ref={fogRef} className={`${styles.layer} ${styles.fog}`} aria-hidden="true" />
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
          <div ref={stripRef} className={styles.strip} role="group" aria-label="段階ごとの件数">
            {columns.map((column) => (
              <button
                key={column.at}
                type="button"
                className={styles.col}
                data-at={column.at}
                aria-expanded={stripOpen === column.at}
                aria-label={`${PROGRESS_STAGE_NAMES[column.at]} ${column.count}件`}
                onClick={() => {
                  const next = stripOpen === column.at ? null : column.at;
                  setStripOpen(next);
                  setCaption(null);
                  engineRef.current?.highlightStrip(next ?? -1);
                }}
              >
                <span className={styles.colName}>{PROGRESS_STAGE_NAMES[column.at]}</span>
                <span className={`${styles.colCount} num`} style={{ color: column.lead ? WHO_CSS[column.lead] : undefined }}>
                  {column.count || "·"}
                </span>
              </button>
            ))}
          </div>
          <div ref={nodesRef} className={styles.nodes}>
            {nodes.map((node) => (
              <button
                key={node.key}
                ref={register(node.key)}
                type="button"
                className={styles.node}
                data-key={node.key}
                data-off=""
                style={{ "--c": WHO_CSS[node.who] } as React.CSSProperties}
                aria-label={`${node.repo}#${node.number} ${node.title}。${node.label}`}
                onMouseEnter={() => show(node.key, false)}
                onMouseLeave={hide}
                onFocus={() => show(node.key, false)}
                onBlur={hide}
                onClick={() => {
                  show(node.key, true);
                  onPick?.(node.key);
                }}
              >
                <span className={styles.l1}>
                  <span className={`${styles.id} num`}>#{node.number}</span>
                  <span className={styles.st}>{node.label}</span>
                </span>
                <span className={styles.t}>
                  <span className={styles.rp}>{node.repo}</span>
                  <span className={styles.tt}>{node.title}</span>
                </span>
              </button>
            ))}
            {dones.length >= 2 && (
              <button
                key="cluster:deployed"
                ref={register("cluster:deployed")}
                type="button"
                className={styles.node}
                data-key="cluster:deployed"
                data-off=""
                style={{ "--c": WHO_CSS.done } as React.CSSProperties}
                aria-label={`公開済み ${dones.length}件`}
                onMouseEnter={() => show("cluster:deployed", false)}
                onMouseLeave={hide}
                onFocus={() => show("cluster:deployed", false)}
                onBlur={hide}
                onClick={() => show("cluster:deployed", true)}
              >
                <span className={styles.l1}>
                  <span className={styles.st}>公開済み {dones.length}件</span>
                </span>
              </button>
            )}
          </div>
        </section>
          <p
            className={styles.caption}
            data-on={current || stripOpen !== null ? "" : undefined}
            data-pinned={caption?.pinned || stripOpen !== null ? "" : undefined}
            aria-live="polite"
            style={{ "--c": current ? WHO_CSS[current.who] : undefined } as React.CSSProperties}
          >
            {stripOpen !== null ? (
              <StripCaption nodes={nodes.filter((n) => n.at === stripOpen)} onPick={onPick} />
            ) : current ? (
              <>
                {current.key !== "cluster:deployed" && (
                  <span className={`${styles.capId} num`}>
                    {current.repo}#{current.number}
                  </span>
                )}
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
        </div>
      )}
    </>
  );
}

function clusterOf(dones: FlowNode[]): FlowNode | null {
  if (dones.length < 2) return null;
  return {
    ...dones[0],
    key: "cluster:deployed",
    number: 0,
    title: "",
    label: `公開済み ${dones.length}件`,
    caption: dones.map((d) => `#${d.number} ${d.title}`).join("　"),
    deployLinks: dones.flatMap((d) => d.deployLinks).slice(0, 4),
    logUrl: null,
  };
}

/** スマホの帯で列を押したとき：その段階の Issue を1行ずつ */
function StripCaption({ nodes, onPick }: { nodes: FlowNode[]; onPick?: (key: string) => void }) {
  if (nodes.length === 0) return <span className={styles.capText}>この段階の作業はありません</span>;
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
          <span className={`${styles.id} num`}>#{node.number}</span>
          <b>{node.label}</b>
          <span className={styles.stripTitle}>{node.title}</span>
        </button>
      ))}
    </span>
  );
}
