"use client";

import { useState, type CSSProperties } from "react";
import { PENDING_COLOR, PROGRESS_STAGE_NAMES, toneRgba, type ProgressBarSpec } from "@/lib/progress";
import { countPipelineWork, filterPipelineRows, type PipelineRow } from "@/lib/pipeline";
import { rowFrame, rowFrameAttr } from "@/lib/rowFrame";
import { PipelineRowLink } from "./PipelineRowLink";
import { PipelineTitle } from "./PipelineTitle";

function barStyle(bar: ProgressBarSpec): CSSProperties {
  if (bar.tone === null) return { background: PENDING_COLOR };
  const color = toneRgba(bar.tone, bar.opacity);
  if (bar.outlineOnly) return { background: "transparent", boxShadow: `inset 0 0 0 1px ${color}` };
  return { background: color };
}

/** パイプライン（リポジトリのページ）：Issueを行、パイプラインの段階を列にした表。スマホでは1件＝1ブロック */
export function PipelineTable({ rows, repoName }: { rows: PipelineRow[]; repoName: string }) {
  const [showDeployed, setShowDeployed] = useState(false);
  const visibleRows = filterPipelineRows(rows, showDeployed);
  const { queued, working } = countPipelineWork(rows);
  const hiddenCount = rows.length - filterPipelineRows(rows, false).length;

  return (
    <section className="section" aria-labelledby="pipeline-title">
      <div className="section-head">
        <h2 className="section-title" id="pipeline-title">
          パイプライン
        </h2>
        <span className="section-note">直近14日・新しいIssueが上</span>
        {queued > 0 && <span className="section-note">順番待ち {queued}件</span>}
        {working > 0 && <span className="section-note">並列で動いている {working}件</span>}
        {rows.length > 0 && (
          <button
            type="button"
            className="refresh-button"
            aria-pressed={showDeployed}
            onClick={() => setShowDeployed((shown) => !shown)}
          >
            {showDeployed ? "公開済みを隠す" : `公開済みを表示（${hiddenCount}）`}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="empty pipeline-empty">直近14日のIssueはありません</p>
      ) : visibleRows.length === 0 ? (
        <p className="empty pipeline-empty">動いている作業はありません</p>
      ) : (
        <div className="pipeline" role="table" aria-label="パイプライン">
          <div className="pipeline-grid pipeline-head" role="row">
            <div className="pipeline-colhead pipeline-colhead-issue" role="columnheader">
              Issue
            </div>
            {PROGRESS_STAGE_NAMES.map((name) => (
              <div className="pipeline-colhead" role="columnheader" key={name}>
                {name}
              </div>
            ))}
          </div>
          {visibleRows.map((row) => (
            <PipelineRowLink
              href={row.issue.url}
              stage={row.status.stage}
              tone={row.progress.tone}
              done={row.status.stage === "deployed"}
              ariaLabel={`${repoName}#${row.issue.number} ${row.issue.title}：${row.description}・${row.progress.ariaLabel}`}
              frame={rowFrameAttr(rowFrame(row.status))}
              key={row.issue.number}
            >
              <div className="pipeline-issue" role="cell">
                <PipelineTitle title={row.issue.title} />
                <span className="pipeline-ref mono">
                  {repoName}#{row.issue.number}
                </span>
                {row.queueReason && (
                  <span className="pipeline-reason" title={row.queueReason}>
                    {row.queueReason}
                  </span>
                )}
                <span className={`pipeline-desc pipeline-desc-mobile pipeline-tone-${row.progress.tone}`}>
                  {row.description}
                </span>
              </div>
              {row.progress.bars.map((bar) => (
                <div className="pipeline-cell" role="cell" key={bar.index}>
                  <span className="progress-bar" style={barStyle(bar)} />
                  {bar.current && (
                    <span className={`pipeline-desc pipeline-desc-cell pipeline-tone-${row.progress.tone}`}>
                      {row.description}
                    </span>
                  )}
                  <span className="pipeline-cell-name" data-current={bar.current ? "true" : undefined}>
                    {bar.name}
                  </span>
                </div>
              ))}
            </PipelineRowLink>
          ))}
        </div>
      )}
    </section>
  );
}
