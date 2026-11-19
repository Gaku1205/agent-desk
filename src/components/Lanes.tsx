"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ciStepText, type CiKind, type CiProgress } from "@/lib/ciProgress";
import { formatSpan } from "@/lib/dashboard/duration";
import { FLOW_STEPS } from "@/lib/flow";
import { assignSlots, lanesHeadline, overLimitNote,type QueueEntry, type Slot } from "@/lib/lanes/slots";
import { queueLine } from "@/lib/lanes/queueLine";
import type { LanesSource, RunEntry } from "@/lib/lanes/source";
import { lanesTurnRows, mergeOrdinals } from "@/lib/lanes/turnRows";
import { heldIndex, withHeldRows, type HeldRow } from "@/lib/operationResult";
import { turnItemKey, turnSig, type TurnItem } from "@/lib/turn";
import { TURN_GROUPS } from "@/lib/turnKind";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import dashboardStyles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskError, type DeskNav } from "./Desk";
import { LoadErrors } from "./LoadErrors";
import type { UsageSource } from "@/lib/lanes/usage";
import { ChartIcon, CircleIcon, ColumnsIcon, PanelLeftIcon, PersonIcon, PlayIcon, SpinnerIcon } from "./icons";
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

/** CI の段の間だけ、7工程の線の代わりに出す、CI のチェックの割合の線（左から 通過・実行中・枠待ち・失敗） */
function CiLine({ ci }: { ci: CiProgress }) {
  return (
    <span className={styles.ciLine} role="img" aria-label={ci.label}>
      {ci.segments.map((segment) => (
        <span
          key={segment.kind}
          className={styles.ciSeg}
          data-kind={segment.kind}
          style={{ "--n": segment.count } as CSSProperties}
        />
      ))}
    </span>
  );
}

function CiMark({ kind }: { kind: CiKind }) {
  switch (kind) {
    case "passed":
      return <span>✓</span>;
    case "running":
      return (
        <span className={styles.spin}>
          <SpinnerIcon size={12} />
        </span>
      );
    case "queued":
      return <QueueIcon size={12} />;
    case "failed":
      return <span>×</span>;
  }
}

/** CI の段の間の1段目の文：`4/7 CI ✓4 ⧗6 枠待ち`（数は記号ごとに線と同じ色） */
function CiText({ at, ci }: { at: number; ci: CiProgress }) {
  return (
    <span className={styles.ciText}>
      <span className={styles.srOnly}>{ciStepText(at, FLOW_STEPS.length, ci)}</span>
      <span className={styles.ciStep} aria-hidden="true">
        <span className="num">
          {at + 1}/{FLOW_STEPS.length}
        </span>{" "}
        CI
      </span>
      {ci.segments.map((segment) => (
        <span key={segment.kind} className={styles.ciCount} data-kind={segment.kind} aria-hidden="true">
          <CiMark kind={segment.kind} />
          <span className="num">{segment.count}</span>
        </span>
      ))}
      <span className={styles.ciWord} aria-hidden="true">
        {ci.word}
      </span>
    </span>
  );
}

/** 席の行の下にぶら下がる、その席の処理の1行 */
function HangRow({ run, last }: { run: RunEntry; last: boolean }) {
  return (
    <li className={styles.hang} data-last={last ? "" : undefined} data-kind="hang">
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

function SlotRow({ slot }: { slot: Slot }) {
  if (slot.kind === "running") {
    const { work } = slot;
    return (
      <>
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
      </li>
      {slot.runs.map((run, index) => (
        <HangRow key={run.key} run={run} last={index === slot.runs.length - 1} />
      ))}
      </>
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

function QueueWhy({ entry, basePath }: { entry: QueueEntry; basePath: string }) {
  const line = queueLine(entry);
  if (line.kind === "text") {
    return (
      <span className={styles.why} title={entry.reason}>
        {line.text}
      </span>
    );
  }
  const { target, more } = line;
  const label = target.kind === "pull" ? `${entry.repo} PR #${target.number}` : `${entry.repo}#${target.number}`;
  // 進捗図は、その作業のあるリポジトリのページで見る（Issue が分からない PR は GitHub の PR）
  const inApp = target.issueNumber !== null;
  const href = inApp ? `${basePath}/repos/${entry.owner}/${entry.repo}` : target.url;
  return (
    <span className={`${styles.why} ${styles.whyFlex}`} title={entry.reason}>
      <span className={styles.whyHead}>待ち：</span>
      <a
        className={styles.waitFor}
        href={href}
        {...(inApp ? {} : { target: "_blank", rel: "noreferrer" })}
      >
        {label}
      </a>
      {target.title !== "" && <span className={styles.whyTitle}>{target.title}</span>}
      {more > 0 && <span className={styles.whyMore}>ほか{more}件</span>}
    </span>
  );
}

function QueueRow({ entry, basePath }: { entry: QueueEntry; basePath: string }) {
  return (
    <li className={styles.row} data-tone="queue" data-kind="queue">
      <div className={styles.left}>
        <span className={styles.rank}>
          <QueueIcon size={13} />
          <span className="num">{entry.rank}</span>
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
        <QueueWhy entry={entry} basePath={basePath} />
      </div>
      <div className={styles.right}>
        {entry.waitingMs !== null && <span className={`${styles.time} num`}>{formatSpan(entry.waitingMs)}</span>}
      </div>
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
            <ul className={styles.list}>
              {lanes.slots.map((slot) => (
                <SlotRow key={slot.kind === "running" ? slot.work.key : `free-${slot.index}`} slot={slot} />
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby={runsId}>
          <SectionHead id={runsId} icon={<PlayIcon size={16} />} title="Background" sub="CI・公開など、席を使わない作業" />
          {lanes.other.length === 0 ? (
            <p className={styles.empty}>いまは CI や公開の作業はありません</p>
          ) : (
            <ul className={styles.list}>
              {lanes.other.map((run) => (
                <RunRow key={run.key} run={run} />
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby={queueId}>
          <SectionHead id={queueId} icon={<QueueIcon size={15} />} title="Queue"
            count={lanes.queue.length}
            sub="席が空いたら上から始まります"
          />
          {lanes.queue.length === 0 ? (
            <p className={styles.empty}>順番待ちの作業はありません</p>
          ) : (
            <ol className={styles.list}>
              {lanes.queue.map((entry) => (
                <QueueRow key={entry.key} entry={entry} basePath={nav.basePath ?? ""} />
              ))}
            </ol>
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
