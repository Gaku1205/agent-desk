import type { WaitingPipelineRow } from "@/lib/waitingPipeline";
import { PipelineGrid } from "./PipelineTable";
import styles from "./WaitingPipelineSection.module.css";

/** 待機中のパイプライン（ホームだけ）：全リポジトリの、順番待ち・やり直し待ちの作業をパイプライン表と同じ形で出す */
export function WaitingPipelineSection({ rows }: { rows: WaitingPipelineRow[] }) {
  return (
    <section className="section" aria-labelledby="waiting-pipeline-title">
      <div className="section-head">
        <h2 className="section-title" id="waiting-pipeline-title">
          待機中のパイプライン <span className={`${styles.count} mono`}>{rows.length}</span>
        </h2>
        <span className="section-note">全リポジトリ・待ちが長い順</span>
      </div>

      {rows.length === 0 ? (
        <p className={`empty ${styles.empty}`}>待っている作業はありません</p>
      ) : (
        <PipelineGrid rows={rows.map((row) => ({ row, repoName: row.repo }))} label="待機中のパイプライン" />
      )}
    </section>
  );
}
