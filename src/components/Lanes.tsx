"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatSpan } from "@/lib/dashboard/duration";
import { FLOW_STEPS } from "@/lib/flow";
import { assignSlots, lanesHeadline, type QueueEntry, type Slot } from "@/lib/lanes/slots";
import type { LanesSource, RunEntry } from "@/lib/lanes/source";
import { lanesTurnRows } from "@/lib/lanes/turnRows";
import { withHeldRows, type HeldRow } from "@/lib/operationResult";
import { formatWait, turnItemKey, turnSig, type TurnItem } from "@/lib/turn";
import { TURN_GROUPS } from "@/lib/turnKind";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import dashboardStyles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskNav } from "./Desk";
import type { UsageSource } from "@/lib/lanes/usage";
import { ChartIcon, CircleIcon, ColumnsIcon, PanelLeftIcon, PersonIcon, PlayIcon, SpinnerIcon } from "./icons";
import styles from "./Lanes.module.css";
import { LanesTurn } from "./LanesTurn";
import { LanesUsage } from "./LanesUsage";
import { useParallelView } from "./ParallelContext";
import { QueueIcon } from "./QueueIcon";
import { SideRepos } from "./TopBar";

type Props = {
  /** サーバーで作った材料（枠を使う作業・順番待ち・動いている実行） */
  source: LanesSource;
  /** Last 24h のグラフの材料（取れなければ null） */
  usage: UsageSource | null;
  /** 「あなたの番」の材料（すでに読んでいる物。Your turn の区画に出す） */
  items: TurnItem[];
  /** 「今」（ISO文字列） */
  now: string;
  nav: DeskNav;
};

/** 片づけた1件を隠しておく長さ */
const TURN_LEAVE_MS = 8000;

/** Your turn：いまの「あなたの番」を1行ずつ並べ、その場で押せる */
function TurnSection({ id, items, now, basePath }: { id: string; items: TurnItem[]; now: Date; basePath: string }) {
  const [held, setHeld] = useState<ReadonlyMap<string, HeldRow<TurnItem>>>(() => new Map());
  const [gone, setGone] = useState<ReadonlyMap<string, string>>(() => new Map());
  const rows = lanesTurnRows(items);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  const hold = useCallback(
    (key: string, value: { item: TurnItem; done: boolean } | null) => {
      setHeld((prev) => {
        const before = prev.get(key);
        if (value === null) {
          if (!before) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        }
        if (before && before.done === value.done) return prev;
        const index = rowsRef.current.findIndex((row) => turnItemKey(row) === key);
        const next = new Map(prev);
        next.set(key, { item: before?.item ?? value.item, index: Math.max(index, 0), done: value.done });
        return next;
      });
    },
    [],
  );

  // 片づけた物は、押した時点の段階の印（`turnSig`）と一緒に覚える。段階が変わって同じ番号がまた出たら隠さない
  const gotAway = useCallback((key: string, sig: string) => {
    setGone((prev) => new Map(prev).set(key, sig));
    // 取り直しが古い内容のままでも、1件が隠れたまま残らないようにする（TurnRow と同じ8秒）
    window.setTimeout(() => {
      setGone((prev) => {
        if (prev.get(key) !== sig) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }, TURN_LEAVE_MS);
    setHeld((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const shown = withHeldRows(rows, held).filter((item) => gone.get(turnItemKey(item)) !== turnSig(item));
  const count = shown.filter((item) => held.get(turnItemKey(item))?.done !== true).length;

  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHead id={id} icon={<PersonIcon size={16} />} title="Your turn" sub={`あなたが押す物 · ${count}件`} />
      <ul className={styles.legend} aria-label="色の見方">
        {TURN_GROUPS.map((g) => (
          <li key={g.group} data-group={g.group}>
            <span className={styles.swatch} aria-hidden="true" />
            {g.label}
          </li>
        ))}
      </ul>
      {shown.length === 0 ? (
        <p className={styles.empty}>あなたが答えることはありません</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((item) => (
            <LanesTurn
              key={turnItemKey(item)}
              item={item}
              wait={formatWait(item.waitingSince, now)}
              basePath={basePath}
              onHold={hold}
              onGone={gotAway}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** 区画の見出し：アイコン → 名前 → 横に説明 */
function SectionHead({ id, icon, title, sub }: { id: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <h2 className={styles.sectionHead} id={id}>
      {icon}
      <span>{title}</span>
      <span className={styles.sectionSub}>{sub}</span>
    </h2>
  );
}

/** 7工程のどこまで来たかの細い線（済み・今・まだ） */
function StepLine({ at }: { at: number }) {
  return (
    <span className={styles.steps} role="img" aria-label={`7工程のうち ${at + 1}番目（${FLOW_STEPS[at].name}）`}>
      {FLOW_STEPS.map((step, index) => (
        <span
          key={step.key}
          className={styles.step}
          data-state={index < at ? "done" : index === at ? "now" : "todo"}
        />
      ))}
    </span>
  );
}

function SlotRow({ slot }: { slot: Slot }) {
  if (slot.kind === "running") {
    const { work } = slot;
    return (
      <li className={styles.row} data-tone="running" data-kind="slot">
        <div className={styles.left}>
          <span className={styles.slotName} data-tone="running">
            <PlayIcon size={12} />
            Slot {slot.index} · Running
          </span>
          <span className={`${styles.ref} num`}>
            {work.repo}#{work.number}
          </span>
        </div>
        <a className={styles.title} href={work.url} target="_blank" rel="noreferrer" title={work.title}>
          {work.title}
        </a>
        <div className={styles.right}>
          <span className={styles.stepRow}>
            <span className={styles.spin} aria-hidden="true">
              <SpinnerIcon size={14} />
            </span>
            <span className={styles.stepText}>{work.stepText}</span>
            {work.elapsedMs !== null && <span className={`${styles.elapsed} num`}>{formatSpan(work.elapsedMs)}</span>}
          </span>
          <StepLine at={work.stepAt} />
        </div>
      </li>
    );
  }
  return (
    <li className={styles.row} data-tone="free" data-kind="slot">
      <div className={styles.left}>
        <span className={styles.slotName} data-tone="free">
          <CircleIcon size={12} />
          Slot {slot.index} · Free
        </span>
        <span className={styles.ref}>空いています</span>
      </div>
      <p className={styles.reason} title={slot.reason}>
        {slot.reason}
      </p>
      <div className={styles.right}>
        {slot.next && (
          <span className={styles.next}>
            <QueueIcon size={12} />
            <span className={styles.nextWord}>次</span>
            <span className="num">
              {slot.next.repo}#{slot.next.number}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}

function RunRow({ run }: { run: RunEntry }) {
  const ref = run.issueNumber !== null ? `${run.repo}#${run.issueNumber}` : run.repo;
  const pull = run.pullNumber !== null ? `${run.issueNumber !== null ? "（" : " "}PR #${run.pullNumber}${run.issueNumber !== null ? "）" : ""}` : "";
  return (
    <li className={styles.row} data-tone="running" data-kind="run">
      <div className={styles.left}>
        <span className={styles.kind}>
          <span className={styles.spin} aria-hidden="true">
            <SpinnerIcon size={13} />
          </span>
          {run.kind}
        </span>
        <span className={`${styles.ref} num`}>
          {ref}
          {pull}
        </span>
      </div>
      <div className={styles.middle}>
        <span className={styles.activity} title={run.activity ?? undefined}>
          {run.activity ?? "—"}
        </span>
        {run.detail && <span className={styles.detail}>{run.detail}</span>}
      </div>
      <div className={`${styles.right} ${styles.runRight}`}>
        {run.elapsedMs !== null && <span className={`${styles.time} num`}>{formatSpan(run.elapsedMs)}</span>}
        {run.logUrl && (
          <a className={styles.log} href={run.logUrl} target="_blank" rel="noreferrer">
            ログ ↗
          </a>
        )}
      </div>
    </li>
  );
}

function QueueRow({ entry }: { entry: QueueEntry }) {
  return (
    <li className={styles.row} data-tone="queue" data-kind="queue">
      <div className={styles.left}>
        <span className={styles.rank}>
          <QueueIcon size={13} />
          <span className="num">#{entry.rank}</span>
        </span>
      </div>
      <div className={styles.middle}>
        <span className={styles.queueTop}>
          <span className={`${styles.ref} num`}>
            {entry.repo}#{entry.number}
          </span>
          <a className={styles.queueTitle} href={entry.url} target="_blank" rel="noreferrer" title={entry.title}>
            {entry.title}
          </a>
        </span>
        <span className={styles.why} title={entry.reason}>
          {entry.reason}
          {entry.waitFor && (
            <>
              。待つ相手：
              <a className={styles.waitFor} href={entry.waitFor.url} target="_blank" rel="noreferrer">
                {entry.waitFor.label}
              </a>
            </>
          )}
        </span>
      </div>
      <div className={styles.right}>
        {entry.waitingMs !== null && <span className={`${styles.time} num`}>{formatSpan(entry.waitingMs)}</span>}
      </div>
    </li>
  );
}

/** Slots & Queue（`/lanes`、デモは `/demo/lanes`）：見出し・Slots・Running・Queue */
export function Lanes({ source, usage, items, now, nav }: Props) {
  const turnId = useId();
  const parallel = useParallelView();
  const limit = parallel?.state?.limit ?? null;
  const lanes = assignSlots(source, limit);
  const at = new Date(now);
  const slotsId = useId();
  const runsId = useId();
  const queueId = useId();
  const usageId = useId();
  const sideCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const toggleSide = useCallback(() => {
    const next = !getSidebarSnapshot();
    applySidebar(next, document.documentElement);
    writeSidebarCollapsed(getBrowserStorage(), next);
  }, []);

  return (
    <div className={dashboardStyles.panes} data-panes="">
      <button
        type="button"
        className={dashboardStyles.sideToggle}
        onClick={toggleSide}
        aria-expanded={!sideCollapsed}
        aria-controls="side-repos"
        aria-label={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
        title={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
      >
        <PanelLeftIcon />
      </button>
      <div className={dashboardStyles.side} id="side-repos" inert={sideCollapsed}>
        <SideRepos {...nav} />
      </div>
      <main id="main" className={styles.main}>
        <header className={styles.head}>
          <div className={styles.titleBox}>
            <h1 className={styles.h1}>Slots &amp; Queue</h1>
            <p className={`${styles.headline} num`}>
              {lanesHeadline(at, parallel?.settings ?? null, parallel?.state ?? null)}
            </p>
          </div>
          <dl className={styles.counts}>
            <div className={styles.count}>
              <dt>
                <span className={styles.okMark}>
                  <PlayIcon size={14} />
                </span>
                Running
              </dt>
              <dd className={`${styles.countValue} num`} data-tone="running">
                {lanes.counts.running}
              </dd>
            </div>
            {lanes.counts.free !== null && (
              <div className={styles.count}>
                <dt>
                  <span className={styles.muteMark}>
                    <CircleIcon size={14} />
                  </span>
                  Free
                </dt>
                <dd className={`${styles.countValue} num`}>{lanes.counts.free}</dd>
              </div>
            )}
            <div className={styles.count}>
              <dt>
                <QueueIcon size={13} />
                Queue
              </dt>
              <dd className={`${styles.countValue} num`} data-tone="queue">
                {lanes.counts.queue}
              </dd>
            </div>
          </dl>
        </header>

        <TurnSection id={turnId} items={items} now={at} basePath={nav.basePath ?? ""} />

        <section className={styles.section} aria-labelledby={slotsId}>
          <SectionHead
            id={slotsId}
            icon={<ColumnsIcon size={16} />}
            title="Slots"
            sub={limit === null ? "" : `${limit}件まで`}
          />
          {lanes.slots.length === 0 ? (
            <p className={styles.empty}>動いている作業はありません</p>
          ) : (
            <ul className={styles.list}>
              {lanes.slots.map((slot) => (
                <SlotRow key={slot.kind === "running" ? slot.work.key : `free-${slot.index}`} slot={slot} />
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby={runsId}>
          <SectionHead id={runsId} icon={<PlayIcon size={16} />} title="Running" sub="いま動いている AI とワークフロー" />
          {lanes.runs.length === 0 ? (
            <p className={styles.empty}>いま動いている実行はありません</p>
          ) : (
            <ul className={styles.list}>
              {lanes.runs.map((run) => (
                <RunRow key={run.key} run={run} />
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby={queueId}>
          <SectionHead id={queueId} icon={<QueueIcon size={15} />} title="Queue" sub="次に入る順" />
          {lanes.queue.length === 0 ? (
            <p className={styles.empty}>順番を待っている作業はありません</p>
          ) : (
            <ol className={styles.list}>
              {lanes.queue.map((entry) => (
                <QueueRow key={entry.key} entry={entry} />
              ))}
            </ol>
          )}
        </section>

        <section className={styles.section} aria-labelledby={usageId}>
          <SectionHead id={usageId} icon={<ChartIcon size={16} />} title="Last 24h" sub="枠の使われ方" />
          <LanesUsage usage={usage} settings={parallel?.settings ?? null} headingId={usageId} />
        </section>
      </main>
    </div>
  );
}
