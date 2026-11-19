"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useParallelView } from "./ParallelContext";
import { barRatios, parallelLabel, USAGE_MODELS, type AiUsage, type UsageModel } from "@/lib/dashboard/aiUsage";
import { formatSpan } from "@/lib/dashboard/duration";
import { FLOW_STEPS } from "@/lib/flow";
import { formatPeriodLabel, PERIOD_KEYS, periodWord, type PeriodKey } from "@/lib/dashboard/period";
import { summarySentence } from "@/lib/dashboard/summary";
import { nextTabIndex } from "@/lib/dashboard/tabKeys";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import styles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskError, type DeskNav } from "./Desk";
import { LoadErrors } from "./LoadErrors";
import {
  formatResetAt,
  hourLabel,
  limitsSummary,
  RATE_LIMIT,
  remainingRatio,
  type GithubLimits,
  type LimitGauge,
} from "@/lib/dashboard/githubLimits";
import { CheckIcon, ChipIcon, CrossIcon, FlowStepIcon, GaugeIcon, KeyIcon, PanelLeftIcon, PersonIcon } from "./icons";
import { QueueIcon } from "./QueueIcon";
import { TurnKindIcon } from "./TurnKindIcon";
import { reasonRatios, STOP_REASONS, type StopReason, type Stops } from "@/lib/dashboard/stops";
import { SideRepos } from "./TopBar";
import { DashboardThroughput } from "./DashboardThroughput";
import { buildBundle, type PeriodBundle } from "@/lib/dashboard/bundle";

type Props = {
  /** 期間ごとの数字（まとめ・Throughput・AI usage・Stops。サーバーで作った小さな値。切り替えても取り直さない）。無い期間（`30d`）は `loadPeriod` で取る */
  bundles: Partial<Record<PeriodKey, PeriodBundle>>;
  /** 無い期間を選んだときに、サーバーで取って数える（Server Action。トークンは画面に渡さない）。無ければ（デモ）取らない */
  loadPeriod?: (key: PeriodKey) => Promise<PeriodBundle | null>;
  /** GitHub limits（期間の切り替えとは関係なく、直近24時間） */
  limits: GithubLimits;
  /** 「今」（ISO文字列） */
  now: string;
  /** 監視中のリポジトリの数 */
  repoCount: number;
  nav: DeskNav;
  /** 読めなかったリポジトリ（あれば、見出しの下に出す。数には入っていない） */
  errors?: DeskError[];
  /** 最初に出す期間（URL の `?period=`。サーバーが決める）。無ければ `24h` */
  initialPeriod?: PeriodKey;
};

/** 期間のリンク先：既定の `24h` は付けない（`?period=7d` など） */
function periodHref(base: string, key: PeriodKey): string {
  return key === "24h" ? base : `${base}?period=${key}`;
}

const DASH = "—";

function count(value: number | null): string {
  return value === null ? DASH : String(value);
}

function span(value: number | null): string {
  return value === null ? DASH : formatSpan(value);
}

/** 表の1列：ラベル → 数 → 補足 */
function Cell({ label, value, note }: { label: string; value: string; note: string | null }) {
  return (
    <div className={styles.cell} role="group" aria-label={label}>
      <dt className={styles.label}>{label}</dt>
      <dd className={`${styles.value} num`}>{value}</dd>
      {/* 補足が無いときも、行の高さは残す（ほかの列とそろえる） */}
      <dd className={`${styles.note} num`} data-empty={note === null ? "" : undefined} aria-hidden={note === null ? true : undefined}>
        {note ?? " "}
      </dd>
    </div>
  );
}

const MODEL_LABELS: Record<UsageModel, string> = { sonnet: "Sonnet", opus: "Opus", fable: "Fable" };

/** 回数のマス：0 は `0` と書かず `—` */
function usageCount(value: number): string {
  return value > 0 ? String(value) : DASH;
}

const USAGE_NOTE = "数字は回数、Total は時間";

/** 1件あたりの時間の横棒：ラベル → 棒 → 値。数える物が無い方は `—` と棒なし */
function LeadBar({ label, ms, ratio }: { label: string; ms: number | null; ratio: number | null }) {
  return (
    <div className={styles.bar}>
      <dt className={styles.barLabel}>{label}</dt>
      <dd className={styles.barTrack}>
        {ratio !== null && (
          <span className={styles.barFill} style={{ width: `${Math.max(ratio * 100, 1)}%` }} aria-hidden="true" />
        )}
      </dd>
      <dd className={`${styles.barValue} num`}>{span(ms)}</dd>
    </div>
  );
}

/** AI usage：左に 工程×モデルの表、右に `Usage limit hits` と 1件あたりの時間の横棒 */
function AiUsageSection({ usage }: { usage: AiUsage }) {
  const headingId = useId();
  const dayLimit = useParallelView()?.settings?.day ?? null;
  const ratios = barRatios(usage.parallelMs, usage.serialMs);
  return (
    <section className={styles.usage} aria-labelledby={headingId}>
      <h2 className={styles.usageHead} id={headingId}>
        <ChipIcon size={16} />
        <span>AI usage</span>
        <span className={styles.usageSub}>AIの使用量</span>
      </h2>
      <div className={styles.usageBody}>
        <div>
        <table className={styles.usageTable}>
          <caption className={styles.srOnly}>{USAGE_NOTE}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.stepCol}>
                Step
              </th>
              {USAGE_MODELS.map((model) => (
                <th scope="col" key={model}>
                  {MODEL_LABELS[model]}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map((row) => (
              <tr key={row.step}>
                <th scope="row" className={styles.stepTh}>
                  <span className={styles.stepCell}>
                    <FlowStepIcon step={row.step} size={17} />
                    <span>{FLOW_STEPS.find((step) => step.key === row.step)?.name}</span>
                  </span>
                </th>
                {USAGE_MODELS.map((model) => (
                  <td key={model} className="num">
                    {usageCount(row.counts[model])}
                  </td>
                ))}
                <td className="num">{span(row.totalMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.usageNote}>{USAGE_NOTE}</p>
        </div>
        <div className={styles.usageSide}>
          {usage.limitHits !== null && (
            <dl className={styles.limit}>
              <dt className={styles.label}>Usage limit hits</dt>
              <dd className={`${styles.value} num`}>{count(usage.limitHits)}</dd>
            </dl>
          )}
          <div>
            <p className={styles.label} title="Issueの作成 → PRのマージ">
              1件あたりの時間 <span className={styles.stopSub}>同時に動かした時／1件ずつの時</span>
            </p>
            <dl className={styles.bars}>
              <LeadBar label={parallelLabel(dayLimit)} ms={usage.parallelMs} ratio={ratios.parallel} />
              <LeadBar label="Serial" ms={usage.serialMs} ratio={ratios.serial} />
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

function num(value: number | null): string {
  return value === null ? DASH : value.toLocaleString("en-US");
}

const STOP_NAMES: Record<StopReason, string> = { ci: "CI", permission: "許可", queue: "順番待ち", human: "人間の確認待ち" };

function StopReasonIcon({ kind }: { kind: StopReason }) {
  switch (kind) {
    case "ci":
      return <FlowStepIcon step="ci" size={17} />;
    case "permission":
      return <KeyIcon size={17} />;
    case "queue":
      return <QueueIcon size={17} />;
    case "human":
      return <PersonIcon size={17} />;
  }
}

/** Stops：左に 止まった理由の内訳、右に 最近止まった物 */
function StopsSection({ stops }: { stops: Stops }) {
  const headingId = useId();
  const ratios = stops.counts === null ? null : reasonRatios(stops.counts);
  return (
    <section className={styles.stops} aria-labelledby={headingId}>
      <h2 className={styles.usageHead} id={headingId}>
        <TurnKindIcon icon="deployFailed" size={16} />
        <span>Stops</span>
        <span className={styles.usageSub}>止まり・失敗</span>
      </h2>
      <div className={styles.usageBody}>
        <div>
          <p className={styles.label}>止まった理由の内訳</p>
          <ul className={styles.reasons}>
            {STOP_REASONS.map((kind) => (
              <li key={kind} className={styles.reason}>
                <span className={styles.reasonName}>
                  <StopReasonIcon kind={kind} />
                  <span>{STOP_NAMES[kind]}</span>
                </span>
                <span className={styles.reasonTrack} aria-hidden="true">
                  {ratios !== null && ratios[kind] > 0 && (
                    <span className={styles.reasonFill} style={{ width: `${Math.max(ratios[kind] * 100, 1)}%` }} />
                  )}
                </span>
                <span className={`${styles.reasonCount} num`}>{count(stops.counts === null ? null : stops.counts[kind])}</span>
              </li>
            ))}
          </ul>
          <p className={`${styles.stopsNote} num`}>
            CIの失敗 {count(stops.ciFailures)}回（うち自動で直った {count(stops.autoFixed)}回）· やり直し {count(stops.retries)}回
          </p>
        </div>
        <div>
          <p className={styles.label}>最近止まった作業</p>
          {stops.counts === null ? (
            <p className={styles.stopsEmpty}>{DASH}</p>
          ) : stops.recent.length === 0 ? (
            <p className={styles.stopsEmpty}>この期間に止まった作業はありません</p>
          ) : (
            <ul className={styles.recent}>
              {stops.recent.map((item) => (
                <li key={`${item.repo}#${item.number}@${item.startedAt}`} className={styles.stop}>
                  <span className={`${styles.stopId} num`}>
                    {item.repo}#{item.number}
                    {item.pull !== null && <span className={styles.stopSub}> PR #{item.pull}</span>}
                    {item.times >= 2 && <span className={styles.stopSub}> ×{item.times}</span>}
                  </span>
                  <span className={styles.stopState} data-fixed={item.fixed ? "" : undefined}>
                    {item.fixed ? <CheckIcon size={14} /> : <CrossIcon size={14} />}
                    <span>{item.fixed ? "Fixed" : "Stuck"}</span>
                  </span>
                  <span className={styles.stopReason} title={item.reason ?? undefined}>
                    {item.reason ?? STOP_NAMES[item.kind]}
                  </span>
                  <span className={`${styles.stopTime} num`}>
                    {formatSpan(item.durationMs)}
                    {item.ongoing ? " · ongoing" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** 残り1つ分：`今 残り 3,912 / 5,000`・横棒・`resets at 11:52` */
function Gauge({ name, gauge }: { name: string; gauge: LimitGauge }) {
  const ratio = remainingRatio(gauge.remaining, gauge.limit);
  return (
    <div className={styles.gauge}>
      <dt className={styles.gaugeName}>{name}</dt>
      <dd className={`${styles.gaugeNow} num`}>
        今 残り <span className={styles.gaugeValue}>{num(gauge.remaining)}</span> / {num(gauge.limit)}
      </dd>
      <dd className={styles.gaugeTrack}>
        {ratio !== null && (
          <span className={styles.gaugeFill} style={{ width: `${Math.max(ratio * 100, 1)}%` }} aria-hidden="true" />
        )}
      </dd>
      <dd className={`${styles.gaugeReset} num`}>resets at {formatResetAt(gauge.resetAt) ?? DASH}</dd>
    </div>
  );
}

const CHART_W = 720;
const CHART_H = 160;
const CHART_PAD = 6;

/**
 * 値の列を、null で切った線の path と、孤立した1つの値の丸の path（長さ0の線を丸い端で描く。別の path にして、
 * 線の太さ・破線の指定を受けないようにする）にする
 */
function linePath(series: (number | null)[], yMax: number): { line: string; dots: string } {
  const step = (CHART_W - 2 * CHART_PAD) / Math.max(series.length - 1, 1);
  const parts: string[] = [];
  const dots: string[] = [];
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length === 1) dots.push(`M${run[0][0]} ${run[0][1]}h0`);
    else if (run.length > 1) parts.push(`M${run.map(([x, y]) => `${x} ${y}`).join("L")}`);
    run = [];
  };
  series.forEach((value, i) => {
    if (value === null) {
      flush();
      return;
    }
    const x = Number((CHART_PAD + i * step).toFixed(1));
    const y = Number((CHART_H - CHART_PAD - (Math.min(value, yMax) / yMax) * (CHART_H - 2 * CHART_PAD)).toFixed(1));
    run.push([x, y]);
  });
  flush();
  return { line: parts.join(""), dots: dots.join("") };
}

/** GitHub limits：2つの残りと、1時間ごとに使った量の線グラフ */
function GithubLimitsSection({ limits }: { limits: GithubLimits }) {
  const headingId = useId();
  const yMax = Math.max(RATE_LIMIT * 1.1, ...limits.pipelineUsed.map((v) => v ?? 0), ...limits.readsUsed.map((v) => v ?? 0));
  const limitY = CHART_H - CHART_PAD - (RATE_LIMIT / yMax) * (CHART_H - 2 * CHART_PAD);
  const summary = limitsSummary(limits.hourStarts, limits.pipelineUsed, limits.readsUsed);
  const last = limits.hourStarts.length - 1;
  const reads = linePath(limits.readsUsed, yMax);
  const pipeline = linePath(limits.pipelineUsed, yMax);
  return (
    <section className={styles.limits} aria-labelledby={headingId}>
      <h2 className={styles.usageHead} id={headingId}>
        <GaugeIcon size={16} />
        <span>GitHub limits</span>
        <span className={styles.usageSub}>残りの回数</span>
      </h2>
      <dl className={styles.gauges}>
        <Gauge name="Pipeline · REST" gauge={limits.pipeline} />
        <Gauge name="agent-desk reads · GraphQL" gauge={limits.reads} />
      </dl>
      <div className={styles.chart}>
        <p className={styles.label}>1時間ごとに使った量</p>
        <ul className={styles.legend}>
          <li>
            <svg width="26" height="8" aria-hidden="true">
              <path d="M0 4h26" stroke="var(--accent)" strokeWidth="2" />
            </svg>
            <span>Pipeline · REST</span>
            <span className={`${styles.legendNow} num`}>この1時間 {num(limits.pipelineUsed[last] ?? null)}</span>
          </li>
          <li>
            <svg width="26" height="8" aria-hidden="true">
              <path d="M0 4h26" stroke="var(--mute)" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            <span>agent-desk reads · GraphQL</span>
            <span className={`${styles.legendNow} num`}>この1時間 {num(limits.readsUsed[last] ?? null)}</span>
          </li>
          <li>
            <svg width="26" height="8" aria-hidden="true">
              <path d="M0 4h26" stroke="var(--fail-soft)" strokeWidth="1.5" strokeDasharray="1.5 3" strokeLinecap="round" />
            </svg>
            <span className="num">上限 {num(RATE_LIMIT)}</span>
          </li>
        </ul>
        <svg
          className={styles.plot}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`1時間ごとに使った量の線グラフ。${summary}`}
        >
          <path
            d={`M${CHART_PAD} ${limitY}H${CHART_W - CHART_PAD}`}
            className={styles.limitLine}
            vectorEffect="non-scaling-stroke"
          />
          <path d={reads.line} className={styles.readsLine} vectorEffect="non-scaling-stroke" />
          <path d={reads.dots} className={styles.readsDot} vectorEffect="non-scaling-stroke" />
          <path d={pipeline.line} className={styles.pipelineLine} vectorEffect="non-scaling-stroke" />
          <path d={pipeline.dots} className={styles.pipelineDot} vectorEffect="non-scaling-stroke" />
        </svg>
        <ol className={`${styles.hours} num`} aria-hidden="true">
          {limits.hourStarts.map((start, i) =>
            i % 6 === last % 6 ? (
              <li
                key={start}
                data-last={i === last ? "" : undefined}
                style={{ left: `${((CHART_PAD + (i * (CHART_W - 2 * CHART_PAD)) / last) / CHART_W) * 100}%` }}
              >
                {hourLabel(start)}:00
              </li>
            ) : null,
          )}
        </ol>
        <p className={styles.chartSummary}>{summary}</p>
        <p className={`${styles.chartRuns} num`}>Actions の実行：{limits.runs === null ? DASH : `${limits.runs} runs`}（この24時間）</p>
      </div>
    </section>
  );
}

/** Dashboard（`/dashboard`、デモは `/demo/dashboard`）：期間で振り返る。見出し・期間の切り替え・まとめ・AI usage・GitHub limits */
export function Dashboard({ bundles, loadPeriod, limits, now, repoCount, nav, errors, initialPeriod = "24h" }: Props) {
  const [period, setPeriod] = useState<PeriodKey>(initialPeriod);
  // `loadPeriod` で取った期間（5分覚えるのはサーバー側。画面では開いている間だけ持つ）
  const [loaded, setLoaded] = useState<Partial<Record<PeriodKey, PeriodBundle>>>({});
  // URL が数字の無い期間（`30d`）のときは、サーバーが「読んでいます…」で描き、動き出したらすぐ読む
  const [pending, setPending] = useState<PeriodKey | null>(
    !bundles[initialPeriod] && loadPeriod ? initialPeriod : null,
  );
  const [failed, setFailed] = useState<PeriodKey | null>(null);
  const tabsId = useId();
  // まだ数字が無い期間（読み込み中・失敗）は、数字を全部 `—` にする（作り物の数字を出さない）
  const bundle = bundles[period] ?? loaded[period] ?? buildBundle([], new Date(now), period);
  const summary = bundle.summary;
  const at = new Date(bundle.now);

  const readPeriod = useCallback(
    (key: PeriodKey) => {
      loadPeriod?.(key)
        .then((result) => {
          if (result) setLoaded((current) => ({ ...current, [key]: result }));
          else setFailed(key);
        })
        .catch(() => setFailed(key))
        .finally(() => setPending((current) => (current === key ? null : current)));
    },
    [loadPeriod],
  );
  const selectPeriod = (key: PeriodKey) => {
    setPeriod(key);
    setFailed(null);
    // 今の URL の期間に揃える（移動はしない。読み込み済みの期間は取り直さない）
    window.history.replaceState(window.history.state, "", periodHref(window.location.pathname, key));
    if (bundles[key] || loaded[key] || !loadPeriod) return;
    setPending(key);
    readPeriod(key);
  };
  // URL が `?period=30d` で開いたとき、動き出した直後に読む（サーバーは「読んでいます…」まで描いてある）
  const initialRead = useRef(false);
  useEffect(() => {
    if (initialRead.current) return; // 最初の1回だけ
    initialRead.current = true;
    if (pending !== null && pending === initialPeriod) readPeriod(initialPeriod);
  }, [pending, initialPeriod, readPeriod]);
  const sideCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const toggleSide = useCallback(() => {
    const next = !getSidebarSnapshot();
    applySidebar(next, document.documentElement);
    writeSidebarCollapsed(getBrowserStorage(), next);
  }, []);

  return (
    <div className={styles.panes} data-panes="">
      <button
        type="button"
        className={styles.sideToggle}
        onClick={toggleSide}
        aria-expanded={!sideCollapsed}
        aria-controls="side-repos"
        aria-label={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
        title={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
      >
        <PanelLeftIcon />
      </button>
      <div className={styles.side} id="side-repos" inert={sideCollapsed}>
        <SideRepos {...nav} />
      </div>
      <main id="main" className={styles.main}>
        <header className={styles.head}>
          <div className={styles.title}>
            <h1 className={styles.h1}>Dashboard</h1>
            <p className={`${styles.range} num`}>{formatPeriodLabel(at, period, repoCount)}</p>
          </div>
          <div className={styles.tabs} role="tablist" aria-label="期間">
            {PERIOD_KEYS.map((key, index) => (
              <a
                key={key}
                // URL のリンク：JS が動く前に押せば、そのまま移動して期間が替わる（Issue #615）
                href={periodHref(`${nav.basePath ?? ""}/dashboard`, key)}
                role="tab"
                id={`${tabsId}-${key}`}
                aria-selected={period === key}
                aria-controls={`${tabsId}-panel`}
                tabIndex={period === key ? 0 : -1}
                className={`${styles.tab} num`}
                onClick={(event) => {
                  // 新しいタブ・修飾キーつきはブラウザに任せる
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  selectPeriod(key);
                }}
                onKeyDown={(event) => {
                  const next = nextTabIndex(event.key, index, PERIOD_KEYS.length);
                  if (next === null) return;
                  event.preventDefault();
                  selectPeriod(PERIOD_KEYS[next]);
                  document.getElementById(`${tabsId}-${PERIOD_KEYS[next]}`)?.focus();
                }}
              >
                {key}
              </a>
            ))}
          </div>
        </header>
        <LoadErrors errors={errors ?? []} />
        <section
          className={styles.summary}
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-${period}`}
        >
          {(pending === period || failed === period) && (
            <p className={styles.periodNote} role="status">
              {pending === period ? `${periodWord(period)}分を読んでいます…` : `${periodWord(period)}分を読めません（もう一度押す）`}
            </p>
          )}
          <p className={styles.sentence}>{summarySentence(summary, periodWord(period))}</p>
          <dl className={styles.table}>
            <Cell
              label="Merged"
              value={count(summary.merged)}
              note={`prev ${period}: ${count(summary.mergedPrev)}${
                summary.merged !== null && summary.mergedSyncExcluded !== null && summary.mergedSyncExcluded > 0
                  ? ` · 配布 ${summary.mergedSyncExcluded}件除く`
                  : ""
              }`}
            />
            <Cell
              label="Lead time（median）"
              value={span(summary.leadMedianMs)}
              note={`p90 ${span(summary.leadP90Ms)}`}
            />
            <Cell
              label="Stopped"
              value={count(summary.stopped)}
              note={summary.fixedByHuman === null ? null : `人間が直したのは ${summary.fixedByHuman}`}
            />
            <Cell
              label="AI time"
              value={span(summary.aiTimeMs)}
              note={`${count(summary.runs)} runs${summary.limitHits === null ? "" : ` · limit hits ${summary.limitHits}`}`}
            />
          </dl>
        </section>
        <DashboardThroughput throughput={bundle.throughput} basePath={nav.basePath} />
        <AiUsageSection usage={bundle.aiUsage} />
        <StopsSection stops={bundle.stops} />
        <GithubLimitsSection limits={limits} />
      </main>
    </div>
  );
}
