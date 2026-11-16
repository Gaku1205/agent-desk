import type { FlowState } from "./flow";

/** 修正の回数の分母（オーナーの指示。docs/spec.md の「CI失敗時の分岐」） */
export const FIX_MAX = 3;

/** CIの結果：チェックが無い（まだ）・実行中・失敗・通った */
export type CiResult = "none" | "running" | "failed" | "passed";

export type FlowBranchInput = {
  ci: CiResult;
  /** 修正の依頼の数（PRへの「直して」の数） */
  fixCount: number;
  /** CIが失敗していて、修正の依頼が出たがまだAIがpushしていない（修正中） */
  fixing?: boolean;
  /** 止まった（枠の最後のブロックを失敗にする） */
  stuck?: boolean;
};

/** 枝の状態：いま進んでいる枝か、通らなかった枝（グレー）か */
export type BranchState = "active" | "notTaken";

export type FlowBranch = {
  /** 「修正 n回目 / 3」の n（1〜3） */
  n: number;
  /** 枠の中の修正ブロックの状態 */
  fixState: FlowState;
  /** 枠（失敗したCIと修正）。CIが通ったら通らなかった枝になりグレー */
  branch: BranchState;
  /** 修正からCIに戻る線 */
  returnLine: boolean;
};

/** 「修正 n回目 / 3」の文 */
export function fixLabel(n: number): string {
  return `修正 ${n}回目 / ${FIX_MAX}`;
}

/**
 * CIの結果と修正の回数から、CI失敗時の分岐（点線の枠・修正 n回目 / 3・戻る線）を決める。
 * 分岐が無い（CIが失敗していない）ときは null
 */
export function getFlowBranch(input: FlowBranchInput): FlowBranch | null {
  const done = Math.max(0, Math.floor(input.fixCount));
  const cap = (n: number) => Math.min(Math.max(n, 1), FIX_MAX);
  switch (input.ci) {
    case "none":
      return null;
    case "passed":
      return done === 0 ? null : { n: cap(done), fixState: "done", branch: "notTaken", returnLine: true };
    case "running":
      return done === 0 ? null : { n: cap(done), fixState: "done", branch: "active", returnLine: true };
    case "failed": {
      if (input.fixing) {
        return { n: cap(done), fixState: input.stuck ? "failed" : "running", branch: "active", returnLine: true };
      }
      if (done >= FIX_MAX) return { n: FIX_MAX, fixState: "failed", branch: "active", returnLine: true };
      return { n: cap(done + 1), fixState: input.stuck ? "failed" : "running", branch: "active", returnLine: true };
    }
  }
}
