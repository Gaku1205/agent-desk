"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { barRatios, USAGE_MODELS, type AiUsage, type UsageModel } from "@/lib/dashboard/aiUsage";
import { formatSpan } from "@/lib/dashboard/duration";
import { FLOW_STEPS } from "@/lib/flow";
import { formatPeriodLabel, PERIOD_KEYS, periodWord, type PeriodKey } from "@/lib/dashboard/period";
import { summarySentence, type Summary } from "@/lib/dashboard/summary";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import styles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskNav } from "./Desk";
import { ChipIcon, FlowStepIcon, PanelLeftIcon } from "./icons";
import { SideRepos } from "./TopBar";

type Props = {
  /** 期間ごとのまとめ（サーバーで作った小さな値。切り替えても取り直さない） */
  summaries: Record<PeriodKey, Summary>;
  /** 期間ごとの AI usage（同じく取り直さない） */
  aiUsages: Record<PeriodKey, AiUsage>;
  /** 「今」（ISO文字列） */
  now: string;
  /** 監視中のリポジトリの数 */
  repoCount: number;
  nav: DeskNav;
};

const DASH = "—";

function count(value: number | null): string {
  return value === null ? DASH : String(value);
}

function span(value: number | null): string {
  return value === null ? DASH : formatSpan(value);
}

/** 表の1列：ラベル → 数 → 補足 */
function Cell({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.cell} role="group" aria-label={label}>
      <dt className={styles.label}>{label}</dt>
      <dd className={`${styles.value} num`}>{value}</dd>
      <dd className={`${styles.note} num`}>{note}</dd>
    </div>
  );
}

const MODEL_LABELS: Record<UsageModel, string> = { sonnet: "Sonnet", opus: "Opus", fable: "Fable" };

/** 回数のマス：0 は `0` と書かず `—` */
function usageCount(value: number): string {
  return value > 0 ? String(value) : DASH;
}

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
  const ratios = barRatios(usage.parallelMs, usage.serialMs);
  return (
    <section className={styles.usage} aria-labelledby={headingId}>
      <h2 className={styles.usageHead} id={headingId}>
        <ChipIcon size={16} />
        <span>AI usage</span>
        <span className={styles.usageSub}>AIの使用量</span>
      </h2>
      <div className={styles.usageBody}>
        <table className={styles.usageTable}>
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
        <div className={styles.usageSide}>
          <dl className={styles.limit}>
            <dt className={styles.label}>Usage limit hits</dt>
            <dd className={`${styles.value} num`}>{count(usage.limitHits)}</dd>
          </dl>
          <div>
            <p className={styles.label}>1件あたりの時間（Issueの作成 → PRのマージ）</p>
            <dl className={styles.bars}>
              <LeadBar label="Parallel 3" ms={usage.parallelMs} ratio={ratios.parallel} />
              <LeadBar label="Serial" ms={usage.serialMs} ratio={ratios.serial} />
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Dashboard（`/dashboard`、デモは `/demo/dashboard`）：期間で振り返る。見出し・期間の切り替え・まとめ・AI usage */
export function Dashboard({ summaries, aiUsages, now, repoCount, nav }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("24h");
  const tabsId = useId();
  const summary = summaries[period];
  const at = new Date(now);
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
            {PERIOD_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${tabsId}-${key}`}
                aria-selected={period === key}
                aria-controls={`${tabsId}-panel`}
                className={`${styles.tab} num`}
                onClick={() => setPeriod(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </header>
        <section
          className={styles.summary}
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={`${tabsId}-${period}`}
        >
          <p className={styles.sentence}>{summarySentence(summary, periodWord(period))}</p>
          <dl className={styles.table}>
            <Cell label="Merged" value={count(summary.merged)} note={`prev ${period}: ${count(summary.mergedPrev)}`} />
            <Cell
              label="Lead time（median）"
              value={span(summary.leadMedianMs)}
              note={`p90 ${span(summary.leadP90Ms)}`}
            />
            <Cell label="Stopped" value={count(summary.stopped)} note={`人間が直したのは ${count(summary.fixedByHuman)}`} />
            <Cell
              label="AI time"
              value={span(summary.aiTimeMs)}
              note={`${count(summary.runs)} runs · limit hits ${count(summary.limitHits)}`}
            />
          </dl>
        </section>
        <AiUsageSection usage={aiUsages[period]} />
      </main>
    </div>
  );
}
