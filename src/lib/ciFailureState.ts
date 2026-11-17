import { FIX_MAX, getFlowBranch } from "./flowBranch";

/**
 * CI失敗の段階（`ciFailed`）が「自動で直している途中」か「本当に止まった」かの判定
 * （docs/spec.md の「いまの様子（会話）」）。
 * 動いている（`fixing`）：`ai:stuck` でなく、修正の回数が上限（FIX_MAX）に達していない。n は右の進捗図の「修正 n回目 / 3」の n
 * 止まった（`stopped`）：`ai:stuck`、または修正の上限までCIが失敗した
 */

export type CiFailureState = { kind: "fixing"; n: number } | { kind: "stopped" };

export type CiFailureInput = {
  /** 段階の名前（`IssueStatus.stage`） */
  stage: string;
  /** `ai:stuck` が付いている（止まった） */
  stuck: boolean;
  /** 修正の依頼の数（`IssueStatus.fixCount`） */
  fixCount: number;
};

/** CI失敗の段階のとき、動いている／止まったを返す。ほかの段階は null（表示を変えない） */
export function ciFailureState(input: CiFailureInput): CiFailureState | null {
  if (input.stage !== "ciFailed") return null;
  if (input.stuck) return { kind: "stopped" };
  if (Math.max(0, Math.floor(input.fixCount)) >= FIX_MAX) return { kind: "stopped" };
  const branch = getFlowBranch({ ci: "failed", fixCount: input.fixCount });
  return { kind: "fixing", n: branch?.n ?? 1 };
}

/** 会話の文：「AIが直しています（1回目/3）」 */
export function ciFixingText(n: number): string {
  return `AIが直しています（${n}回目/${FIX_MAX}）`;
}
