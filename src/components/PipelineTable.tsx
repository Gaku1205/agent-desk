"use client";

import { useState, type CSSProperties } from "react";
import {
  PENDING_COLOR,
  PROGRESS_STAGE_NAMES,
  toneRgba,
  type ProgressBarSpec,
  type ProgressTone,
} from "@/lib/progress";
import {
  countPipelineWork,
  deployedMoreLabel,
  getPipelineView,
  showMoreDeployed,
  type PipelineRow,
} from "@/lib/pipeline";
import { rowFrame, rowFrameAttr } from "@/lib/rowFrame";
import { toggleQueueReasonOpen } from "@/lib/queueReasonOpen";
import { PipelineRowLink } from "./PipelineRowLink";
import { PipelineTitle } from "./PipelineTitle";
import { TriangleDownIcon, TriangleUpIcon } from "./icons";
import styles from "./PipelineTable.module.css";
import progressStyles from "./ProgressBar.module.css";

const TONE_CLASS: Record<ProgressTone, string> = {
  human: styles.toneHuman,
  ai: styles.toneAi,
  done: styles.toneDone,
  fail: styles.toneFail,
  queue: styles.toneQueue,
};

function barStyle(bar: ProgressBarSpec): CSSProperties {
  if (bar.tone === null) return { background: PENDING_COLOR };
  const color = toneRgba(bar.tone, bar.opacity);
  if (bar.outlineOnly) return { background: "transparent", boxShadow: `inset 0 0 0 1px ${color}` };
  return { background: color };
}

/** パイプライン（リポジトリのページ）：Issueを行、パイプラインの段階を列にした表。スマホでは1件＝1ブロック */
export function PipelineTable({ rows, repoName }: { rows: PipelineRow[]; repoName: string }) {
  /** 出している公開済みの行の数（押すたびに5件ずつ増える） */
  const [deployedShown, setDeployedShown] = useState(0);
  const view = getPipelineView(rows, deployedShown);
  const visibleRows = view.rows;
  const moreLabel = deployedMoreLabel(view);
  const { queued, working } = countPipelineWork(rows);

  return (
    <section className="section" aria-labelledby="pipeline-title">
      <div className="section-head">
        <h2 className="section-title" id="pipeline-title">
          パイプライン
        </h2>
        <span className="section-note">直近14日・新しい順</span>
        {queued > 0 && <span className="section-note">順番待ち {queued}件</span>}
        {working > 0 && <span className="section-note">並列動作：{working}件</span>}
      </div>

      {rows.length === 0 ? (
        <p className={`empty ${styles.empty}`}>直近14日のIssueはありません</p>
      ) : visibleRows.length === 0 ? (
        <p className={`empty ${styles.empty}`}>動いている作業はありません</p>
      ) : (
        <PipelineGrid rows={visibleRows.map((row) => ({ row, repoName }))} label="パイプライン" />
      )}

      {view.deployedTotal > 0 && (
        <div className={styles.deployedMore}>
          {moreLabel !== null && (
            <button
              type="button"
              className={styles.toggle}
              onClick={() => setDeployedShown(showMoreDeployed(view.deployedShown, view.deployedTotal))}
            >
              {moreLabel}
              <span className={styles.caret}>
                <TriangleDownIcon />
              </span>
            </button>
          )}
          {view.deployedShown > 0 && (
            <button type="button" className={styles.toggle} onClick={() => setDeployedShown(0)}>
              公開済みを隠す
              <span className={styles.caret}>
                <TriangleUpIcon />
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** 表の1行と、その行のリポジトリ名（`owner/` を省いた名前。`agent-desk#22` の形で出す） */
export type PipelineGridRow = { row: PipelineRow; repoName: string };

/** パイプラインの表の本体（列の見出しと行）。リポジトリのページの表と、ホームの「実行中のパイプライン」で使う */
export function PipelineGrid({ rows, label }: { rows: PipelineGridRow[]; label: string }) {
  /** 理由を開いている行の Issue 番号。取り直しで表が描き直されても残る */
  const [openReasons, setOpenReasons] = useState<ReadonlySet<number>>(() => new Set());

  return (
    <div className={styles.table} role="table" aria-label={label}>
      <div className={`${styles.grid} ${styles.head}`} role="row">
        <div className={`${styles.colhead} ${styles.colheadIssue}`} role="columnheader">
          Issue
        </div>
        {PROGRESS_STAGE_NAMES.map((name) => (
          <div className={styles.colhead} role="columnheader" key={name}>
            {name}
          </div>
        ))}
      </div>
      {rows.map(({ row, repoName }) => {
        const reason = row.queueReason ?? row.deployFailReason;
        return (
        <PipelineRowLink
          href={row.issue.url}
          stage={row.status.stage}
          tone={row.progress.tone}
          done={row.status.stage === "deployed"}
          ariaLabel={`${repoName}#${row.issue.number} ${row.issue.title}：${row.description}・${row.progress.ariaLabel}`}
          frame={rowFrameAttr(rowFrame(row.status))}
          key={`${repoName}#${row.issue.number}`}
        >
          <div className={styles.issue} role="cell">
            <PipelineTitle title={row.issue.title} />
            <span className={`${styles.ref} mono`}>
              {repoName}#{row.issue.number}
            </span>
            {reason && (
              <>
                {/* 行全体がリンクなので、押してもIssueへ移動しないようにする */}
                <button
                  type="button"
                  className={styles.toggle}
                  aria-expanded={openReasons.has(row.issue.number)}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenReasons((open) => toggleQueueReasonOpen(open, row.issue.number));
                  }}
                >
                  {openReasons.has(row.issue.number) ? "理由を閉じる" : "理由を見る"}
                  <span className={styles.caret}>
                    <TriangleDownIcon />
                  </span>
                </button>
                {openReasons.has(row.issue.number) && (
                  <span className={`${styles.reason} ${styles.reasonOpen}`}>{reason}</span>
                )}
              </>
            )}
            {row.deployLinks.length > 0 && (
              <span className={styles.deployLinks}>
                {row.deployLinks.map((link) => (
                  // 行全体がリンクなので、入れ子のリンクにせず、押したら新しいタブで開く
                  <button
                    type="button"
                    className={styles.toggle}
                    key={link.url}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      window.open(link.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    {link.label} ↗
                  </button>
                ))}
              </span>
            )}
            <span className={`${styles.desc} ${styles.descMobile} ${TONE_CLASS[row.progress.tone]}`}>
              {row.description}
            </span>
          </div>
          {row.progress.bars.map((bar) => (
            <div className={styles.cell} role="cell" key={bar.index}>
              <span className={progressStyles.bar} style={barStyle(bar)} />
              {bar.current && (
                <span className={`${styles.desc} ${styles.descCell} ${TONE_CLASS[row.progress.tone]}`}>
                  {row.description}
                </span>
              )}
              <span className={styles.cellName} data-current={bar.current ? "true" : undefined}>
                {bar.name}
              </span>
            </div>
          ))}
        </PipelineRowLink>
        );
      })}
    </div>
  );
}
