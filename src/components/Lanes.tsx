"use client";

import { useCallback, useId, useSyncExternalStore, type ReactNode } from "react";
import { formatSpan } from "@/lib/dashboard/duration";
import { FLOW_STEPS } from "@/lib/flow";
import { assignSlots, lanesHeadline, type QueueEntry, type Slot } from "@/lib/lanes/slots";
import type { LanesSource, RunEntry } from "@/lib/lanes/source";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import dashboardStyles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskNav } from "./Desk";
import type { UsageSource } from "@/lib/lanes/usage";
import { ChartIcon, CircleIcon, ColumnsIcon, PanelLeftIcon, PlayIcon, SpinnerIcon } from "./icons";
import styles from "./Lanes.module.css";
import { LanesUsage } from "./LanesUsage";
import { useParallelView } from "./ParallelContext";
import { QueueIcon } from "./QueueIcon";
import { SideRepos } from "./TopBar";

type Props = {
  /** サーバーで作った材料（枠を使う作業・順番待ち・動いている実行） */
  source: LanesSource;
  /** Last 24h のグラフの材料（取れなければ null） */
  usage: UsageSource | null;
  /** 「今」（ISO文字列） */
  now: string;
  nav: DeskNav;
};

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
export function Lanes({ source, usage, now, nav }: Props) {
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
