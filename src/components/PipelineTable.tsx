"use client";

import { useState, type CSSProperties } from "react";
import { PENDING_COLOR, PROGRESS_STAGE_NAMES, toneRgba, type ProgressBarSpec } from "@/lib/progress";
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
  /** 理由を開いている行の Issue 番号。取り直しで表が描き直されても残る */
  const [openReasons, setOpenReasons] = useState<ReadonlySet<number>>(() => new Set());
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
                  <>
                    {/* 行全体がリンクなので、押してもIssueへ移動しないようにする */}
                    <button
                      type="button"
                      className="pipeline-reason-toggle"
                      aria-expanded={openReasons.has(row.issue.number)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenReasons((open) => toggleQueueReasonOpen(open, row.issue.number));
                      }}
                    >
                      {openReasons.has(row.issue.number) ? "理由を閉じる" : "理由を見る"}
                      <span className="pipeline-reason-caret">
                        <TriangleDownIcon />
                      </span>
                    </button>
                    {openReasons.has(row.issue.number) && (
                      <span className="pipeline-reason pipeline-reason-open">{row.queueReason}</span>
                    )}
                  </>
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

      {view.deployedTotal > 0 && (
        <div className="pipeline-deployed-more">
          {moreLabel !== null && (
            <button
              type="button"
              className="pipeline-reason-toggle"
              onClick={() => setDeployedShown(showMoreDeployed(view.deployedShown, view.deployedTotal))}
            >
              {moreLabel}
              <span className="pipeline-reason-caret">
                <TriangleDownIcon />
              </span>
            </button>
          )}
          {view.deployedShown > 0 && (
            <button type="button" className="pipeline-reason-toggle" onClick={() => setDeployedShown(0)}>
              公開済みを隠す
              <span className="pipeline-reason-caret">
                <TriangleUpIcon />
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
