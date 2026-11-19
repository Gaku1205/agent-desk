"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatSpan } from "@/lib/dashboard/duration";
import { FLOW_STEPS } from "@/lib/flow";
import { assignSlots, freeRowText, lanesHeadline, overLimitNote, type Slot } from "@/lib/lanes/slots";
import {
  multiWaitText,
  NEXT_FREE_TEXT,
  queueGroups,
  queueRowMeta,
  queueRowTitle,
  targetLabel,
  workStepText,
  type QueueGroup,
  type QueueGroupRow,
} from "@/lib/lanes/queueGroups";
import { isLongSleep, jobGauge, sleepingCountText, sortByWake, wakeTimeText, type JobGauge } from "@/lib/lanes/sleeping";
import type { LanesSource, RunEntry, WaitTarget } from "@/lib/lanes/source";
import { lanesTurnRows, mergeOrdinals } from "@/lib/lanes/turnRows";
import { heldIndex, withHeldRows, type HeldRow } from "@/lib/operationResult";
import { turnItemKey, turnSig, type TurnItem } from "@/lib/turn";
import { TURN_GROUPS } from "@/lib/turnKind";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import dashboardStyles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskError, type DeskNav } from "./Desk";
import { CiLine, CiText } from "./CiProgress";
import { LoadErrors } from "./LoadErrors";
import type { UsageSource } from "@/lib/lanes/usage";
import {
  ChartIcon,
  ChevronIcon,
  CircleIcon,
  ColumnsIcon,
  MoonIcon,
  PanelLeftIcon,
  PersonIcon,
  PlayIcon,
  SpinnerIcon,
} from "./icons";
import styles from "./Lanes.module.css";
import { PausedList } from "./LanesPaused";
import { LanesTurn } from "./LanesTurn";
import { LanesUsage } from "./LanesUsage";
import { useParallelView } from "./ParallelContext";
import { QueueIcon } from "./QueueIcon";
import { SideRepos } from "./TopBar";
import { TurnKindIcon } from "./TurnKindIcon";

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
  /** 読めなかったリポジトリ（あれば、見出しの下に出す。数や一覧には入っていない） */
  errors?: DeskError[];
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
        const index = heldIndex(before, rowsRef.current, key);
        const next = new Map(prev);
        next.set(key, { item: before?.item ?? value.item, index, done: value.done });
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
  const ordinals = mergeOrdinals(shown);
  const count = shown.filter((item) => held.get(turnItemKey(item))?.done !== true).length;

  return (
    <section className={styles.section} aria-labelledby={id}>
      <SectionHead id={id} icon={<PersonIcon size={16} />} title="Your turn" count={count} />
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
          {shown.map((item, index) => (
            <LanesTurn
              key={turnItemKey(item)}
              item={item}
              wait={formatSpan(now.getTime() - Date.parse(item.waitingSince))}
              mergeOrder={ordinals.get(index) ?? null}
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

/** 区画の見出し：アイコン → 名前（数があれば `Your turn 1` のように数字だけを続ける） → 横に説明（意味を足すときだけ） */
function SectionHead({
  id,
  icon,
  title,
  count,
  sub,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  count?: ReactNode;
  sub?: string;
}) {
  return (
    <h2 className={styles.sectionHead} id={id}>
      {icon}
      <span>
        {title}
        {count !== undefined && <span className="num"> {count}</span>}
      </span>
      {sub && <span className={styles.sectionSub}>{sub}</span>}
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

/** 席の行の下にぶら下がる、その席の処理の1行 */
function HangRow({ run }: { run: RunEntry }) {
  return (
    <li className={styles.hang} data-kind="hang">
      <span className={styles.hangKind}>
        <span className={styles.spin} aria-hidden="true">
          <SpinnerIcon size={13} />
        </span>
        {run.kind}
      </span>
      <span className={styles.hangActivity} title={run.activity ?? undefined}>
        {run.activity ?? "—"}
      </span>
      {run.detail && <span className={styles.hangDetail}>{run.detail}</span>}
      {run.elapsedMs !== null && <span className={`${styles.time} num`}>{formatSpan(run.elapsedMs)}</span>}
      {run.logUrl && (
        <a className={`${styles.log} ${styles.hangLog}`} href={run.logUrl} target="_blank" rel="noreferrer">
          ログ ↗
        </a>
      )}
    </li>
  );
}

type RunningSlot = Extract<Slot, { kind: "running" }>;

function SlotRow({ slot }: { slot: RunningSlot }) {
  const { work } = slot;
  return (
      <li className={styles.seat}>
      <div className={styles.row} data-tone="running" data-kind="slot">
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
            {work.ci ? (
              <CiText at={work.stepAt} ci={work.ci} />
            ) : (
              <>
                <span className={styles.spin} aria-hidden="true">
                  <SpinnerIcon size={14} />
                </span>
                <span className={styles.stepText}>{work.stepText}</span>
              </>
            )}
            {work.elapsedMs !== null && <span className={`${styles.elapsed} num`}>{formatSpan(work.elapsedMs)}</span>}
          </span>
          {work.ci ? <CiLine ci={work.ci} /> : <StepLine at={work.stepAt} />}
        </div>
      </div>
      {slot.runs.length > 0 && (
        <ul className={styles.hangList}>
          {slot.runs.map((run) => (
            <HangRow key={run.key} run={run} />
          ))}
        </ul>
      )}
      </li>
  );
}

/** 空きの席をまとめた1行：`○ Free × 3`・`Waiting 4 · 下の作業が終わるのを待っている`（Issue #586） */
function FreeRow({ count, queue }: { count: number; queue: number }) {
  const { waiting, text } = freeRowText(queue);
  return (
    <li className={`${styles.seat} ${styles.row}`} data-tone="free" data-kind="free">
      <span className={styles.slotName} data-tone="free">
        <CircleIcon size={12} />
        Free ×<span className="num">{count}</span>
      </span>
      <p className={styles.freeText}>
        {waiting !== null && (
          <>
            <span className="num">Waiting {waiting}</span> ·{" "}
          </>
        )}
        {text}
      </p>
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

/** Background の見出しの右：`Actions jobs` と20マスの目盛りと `12/20`（Issue #584） */
function JobGaugeView({ gauge }: { gauge: JobGauge }) {
  return (
    <div className={styles.gauge}>
      <span className={styles.gaugeName} aria-hidden="true">
        Actions jobs
      </span>
      <span className={styles.gaugeCells} role="img" aria-label={gauge.label}>
        {gauge.cells.map((cell, index) => (
          <span key={index} className={styles.gaugeCell} data-cell={cell} />
        ))}
      </span>
      <span className={`${styles.gaugeText} num`} aria-hidden="true">
        {gauge.text}
      </span>
    </div>
  );
}

/** Background の中の小見出し（`Active 2`・`Sleeping 10 · Long 8`） */
function SubHead({ title, count }: { title: string; count: string }) {
  return (
    <h3 className={styles.subHead}>
      {title}
      <span className={`${styles.subCount} num`}>{count}</span>
    </h3>
  );
}

function LongTag() {
  return <span className={styles.longTag}>Long</span>;
}

/** 起きる時刻の早い順に先頭から出す数（残りは `+7`） */
const SLEEP_PEEK = 3;

/** Sleeping：目覚ましを1行にまとめ、押すと1つずつ開く（Issue #584） */
function SleepingRow({ runs, now }: { runs: RunEntry[]; now: Date }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const peek = runs.slice(0, SLEEP_PEEK);
  const rest = runs.length - peek.length;
  return (
    <>
      <li className={styles.sleepItem}>
        <button
          type="button"
          className={styles.row}
          data-tone="sleeping"
          data-kind="sleep"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.left}>
            <span className={styles.kind}>
              <span className={styles.moon} aria-hidden="true">
                <MoonIcon size={13} />
              </span>
              Resume
            </span>
            <span className={styles.ref}>Retry timer</span>
          </span>
          <span className={styles.wakeList}>
            {peek.map((run) => (
              <span key={run.key} className={styles.wake}>
                {run.wakeAtMs !== null && (
                  <span className={`${styles.wakeTime} num`}>{wakeTimeText(run.wakeAtMs, now)}</span>
                )}
                <span className={styles.wakeRepo}>{run.repo}</span>
                {isLongSleep(run.wakeAtMs, now) && <LongTag />}
              </span>
            ))}
            {rest > 0 && <span className={`${styles.wakeMore} num`}>+{rest}</span>}
          </span>
          <span className={`${styles.right} ${styles.chevron}`} aria-hidden="true">
            <ChevronIcon size={14} />
          </span>
        </button>
      </li>
      <li className={styles.sleepOpen} hidden={!open}>
        <ul id={listId} className={styles.sleepList} aria-label="Retry timer">
          {runs.map((run) => (
            <li key={run.key} className={styles.sleepSub}>
              <span className={`${styles.wakeTime} num`}>
                {run.wakeAtMs !== null ? wakeTimeText(run.wakeAtMs, now) : ""}
              </span>
              <span className={styles.sleepRepo}>
                <span className={styles.sleepRepoName}>{run.repo}</span>
                {isLongSleep(run.wakeAtMs, now) && <LongTag />}
              </span>
              <span className={`${styles.time} ${styles.sleepTime} num`}>
                {run.elapsedMs !== null ? formatSpan(run.elapsedMs) : ""}
              </span>
              {run.logUrl ? (
                <a className={`${styles.log} ${styles.sleepLog}`} href={run.logUrl} target="_blank" rel="noreferrer">
                  ログ ↗
                </a>
              ) : (
                <span className={styles.sleepLog} />
              )}
            </li>
          ))}
        </ul>
      </li>
    </>
  );
}

/** Background：`Active`（動いている）と `Sleeping`（寝ている）に分けて出す */
function BackgroundSection({ id, other, all, now }: { id: string; other: RunEntry[]; all: RunEntry[]; now: Date }) {
  const active = other.filter((run) => !run.sleeping);
  const sleeping = sortByWake(other.filter((run) => run.sleeping));
  const gauge = jobGauge(all);
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.bgHead}>
        <SectionHead id={id} icon={<PlayIcon size={16} />} title="Background" sub="CI・公開など、席を使わない作業" />
        <JobGaugeView gauge={gauge} />
      </div>
      {active.length === 0 && sleeping.length === 0 ? (
        <p className={styles.empty}>いまは CI や公開の作業はありません</p>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <SubHead title="Active" count={String(active.length)} />
              <ul className={styles.list}>
                {active.map((run) => (
                  <RunRow key={run.key} run={run} />
                ))}
              </ul>
            </>
          )}
          {sleeping.length > 0 && (
            <>
              <SubHead title="Sleeping" count={sleepingCountText(sleeping, now)} />
              <ul className={styles.list}>
                <SleepingRow runs={sleeping} now={now} />
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** 親の行の相手の番号（`#553`・`PR #36`）。進捗図は、その作業のあるリポジトリのページで見る（Issue が分からない PR は GitHub の PR） */
function TargetLink({ target, group, basePath }: { target: WaitTarget; group: QueueGroup; basePath: string }) {
  const inApp = target.issueNumber !== null;
  const href = inApp ? `${basePath}/repos/${group.owner}/${group.repo}` : target.url;
  return (
    <a className={styles.groupRef} href={href} {...(inApp ? {} : { target: "_blank", rel: "noreferrer" })}>
      {targetLabel(target)}
    </a>
  );
}

/** まとまりの親の行（1行・40px）：待つ相手 → 相手の題名（または文） → 相手の今の工程 */
function GroupHead({ group, basePath }: { group: QueueGroup; basePath: string }) {
  if (group.kind === "next") {
    return (
      <div className={styles.groupHead} data-kind="next">
        <span className={styles.groupLeft}>
          <CircleIcon size={12} />
          Next free slot
        </span>
        <span className={styles.groupText}>{NEXT_FREE_TEXT}</span>
      </div>
    );
  }
  const middle =
    group.kind === "multi" ? multiWaitText(group.targets.length) : group.work?.title ?? group.targets[0].title;
  return (
    <div className={styles.groupHead} data-kind={group.kind} data-tone={group.tone}>
      <span className={styles.groupLeft}>
        {group.tone === "running" ? <PlayIcon size={12} /> : group.kind === "multi" ? <CircleIcon size={12} /> : null}
        <span className={`${styles.groupRefs} num`}>
          {group.targets.map((target, index) => (
            <span key={`${target.kind}:${target.number}`}>
              {index > 0 && <span className={styles.groupPlus}> + </span>}
              <TargetLink target={target} group={group} basePath={basePath} />
            </span>
          ))}
        </span>
      </span>
      <span
        className={styles.groupText}
        data-muted={group.kind === "work" ? undefined : ""}
        title={group.kind === "multi" ? undefined : middle}
      >
        {middle}
      </span>
      {group.work && <span className={styles.groupStep}>{workStepText(group.work)}</span>}
    </div>
  );
}

/** まとまりの子の行（1行・28px）：`⧗ 1`・題名・`agent-desk#556 · TopBar.tsx`・待ち時間 */
function QueueChildRow({ row }: { row: QueueGroupRow }) {
  const { entry } = row;
  return (
    <li className={styles.qRow} data-depth={row.depth} title={queueRowTitle(entry)}>
      <span className={styles.qRank}>
        <QueueIcon size={12} />
        <span className="num">{row.order}</span>
      </span>
      <a className={styles.qTitle} href={entry.url} target="_blank" rel="noreferrer" title={entry.title}>
        {entry.title}
      </a>
      <span className={`${styles.qMeta} num`}>{queueRowMeta(row)}</span>
      <span className={`${styles.qTime} num`}>{entry.waitingMs !== null ? formatSpan(entry.waitingMs) : ""}</span>
    </li>
  );
}

function QueueGroupView({ group, basePath }: { group: QueueGroup; basePath: string }) {
  return (
    <li className={styles.group} data-tone={group.kind === "next" ? "idle" : group.tone}>
      <GroupHead group={group} basePath={basePath} />
      <ol className={styles.groupRows}>
        {group.rows.map((row) => (
          <QueueChildRow key={row.entry.key} row={row} />
        ))}
      </ol>
    </li>
  );
}

/** Slots & Queue（`/lanes`、デモは `/demo/lanes`）：見出し・Slots・Running・Queue */
export function Lanes({ source, usage, items, now, nav, errors }: Props) {
  const turnId = useId();
  const parallel = useParallelView();
  const limit = parallel?.state?.limit ?? null;
  const lanes = assignSlots(source, limit);
  const overLimit = overLimitNote(lanes.counts.running, limit);
  const runningSlots = lanes.slots.filter((slot): slot is RunningSlot => slot.kind === "running");
  const freeCount = lanes.slots.length - runningSlots.length;
  const groups = queueGroups(lanes.queue, source.works);
  const at = new Date(now);
  const slotsId = useId();
  const runsId = useId();
  const queueId = useId();
  const usageId = useId();
  const pausedId = useId();
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
                <span className={styles.countRuns}>（Actions {lanes.counts.runs}）</span>
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
        <LoadErrors errors={errors ?? []} />

        <TurnSection id={turnId} items={items} now={at} basePath={nav.basePath ?? ""} />

        <section className={styles.section} aria-labelledby={slotsId}>
          <SectionHead
            id={slotsId}
            icon={<ColumnsIcon size={16} />}
            title="Slots"
            count={limit === null ? undefined : `${lanes.counts.running} / ${limit}`}
            sub={limit === null ? undefined : "使用中"}
          />
          {overLimit ? <p className={styles.slotsNote}>{overLimit}</p> : null}
          {lanes.slots.length === 0 ? (
            <p className={styles.empty}>動いている作業はありません</p>
          ) : (
            <ul className={`${styles.list} ${styles.seatList}`}>
              {runningSlots.map((slot) => (
                <SlotRow key={slot.work.key} slot={slot} />
              ))}
              {freeCount > 0 && <FreeRow count={freeCount} queue={lanes.queue.length} />}
            </ul>
          )}
        </section>

        <BackgroundSection id={runsId} other={lanes.other} all={source.runs} now={at} />

        <section className={styles.section} aria-labelledby={queueId}>
          <SectionHead id={queueId} icon={<QueueIcon size={15} />} title="Queue"
            count={lanes.queue.length}
            sub="席が空いたら上から始まります"
          />
          {lanes.queue.length === 0 ? (
            <p className={styles.empty}>順番待ちの作業はありません</p>
          ) : (
            <ul className={`${styles.list} ${styles.groupList}`}>
              {groups.map((group) => (
                <QueueGroupView key={group.key} group={group} basePath={nav.basePath ?? ""} />
              ))}
            </ul>
          )}
        </section>

        {source.paused.length > 0 && (
          <section className={styles.section} aria-labelledby={pausedId}>
            <SectionHead
              id={pausedId}
              icon={<TurnKindIcon icon="onHold" size={16} />}
              title="Paused"
              count={source.paused.length}
              sub="理由があって止めています"
            />
            <PausedList entries={source.paused} now={at} />
          </section>
        )}

        <section className={styles.section} aria-labelledby={usageId}>
          <SectionHead id={usageId} icon={<ChartIcon size={16} />} title="Last 24h" sub="席の使われ方" />
          <LanesUsage usage={usage} settings={parallel?.settings ?? null} headingId={usageId} />
        </section>
      </main>
    </div>
  );
}
