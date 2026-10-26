import type { RunningPipelineRow } from "@/lib/runningPipeline";
import { PipelineGrid } from "./PipelineTable";
import styles from "./RunningPipelineSection.module.css";

/** 実行中のパイプライン（ホームだけ）：全リポジトリの、AIの番で動いている作業をパイプライン表と同じ形で出す */
export function RunningPipelineSection({ rows }: { rows: RunningPipelineRow[] }) {
  return (
    <section className="section" aria-labelledby="running-pipeline-title">
      <div className="section-head">
        <h2 className="section-title" id="running-pipeline-title">
          実行中のパイプライン <span className={`${styles.count} mono`}>{rows.length}</span>
        </h2>
        <span className="section-note">全リポジトリ</span>
      </div>

      {rows.length === 0 ? (
        <p className={`empty ${styles.empty}`}>いま動いているパイプラインはありません</p>
      ) : (
        <PipelineGrid rows={rows.map((row) => ({ row, repoName: row.repo }))} label="実行中のパイプライン" />
      )}
    </section>
  );
}
