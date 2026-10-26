/** リポジトリのパイプラインが動いているか（docs/spec.md の「パイプラインが動いていない」） */
export type PipelineState = "running" | "notConfigured" | "unknown";

/** `pipeline.yml` の実行を調べた結果。調べられなかったときは null */
export type PipelineProbe = {
  /** `pipeline.yml` があるか */
  workflowExists: boolean;
  /** ワークフローの実行の総数 */
  runCount: number;
} | null;

/**
 * `pipeline.yml` が無い、またはワークフローの実行が1度も無いなら「動いていない」。
 * 確かめられないときは「分からない」（誤って「未設定」と出さない）
 */
export function judgePipelineState(probe: PipelineProbe): PipelineState {
  if (probe === null) return "unknown";
  if (!probe.workflowExists || probe.runCount === 0) return "notConfigured";
  return "running";
}
