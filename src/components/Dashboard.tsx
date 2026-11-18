"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { formatSpan } from "@/lib/dashboard/duration";
import { formatPeriodLabel, PERIOD_KEYS, periodWord, type PeriodKey } from "@/lib/dashboard/period";
import { summarySentence, type Summary } from "@/lib/dashboard/summary";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import styles from "./Dashboard.module.css";
import { getSidebarSnapshot, subscribeSidebar, type DeskNav } from "./Desk";
import { PanelLeftIcon } from "./icons";
import { SideRepos } from "./TopBar";

type Props = {
  /** 期間ごとのまとめ（サーバーで作った小さな値。切り替えても取り直さない） */
  summaries: Record<PeriodKey, Summary>;
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

/** Dashboard（`/dashboard`、デモは `/demo/dashboard`）：期間で振り返る。見出し・期間の切り替え・まとめ */
export function Dashboard({ summaries, now, repoCount, nav }: Props) {
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
      </main>
    </div>
  );
}
