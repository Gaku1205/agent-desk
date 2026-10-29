import type { MergeSummary } from "./turn";

/** マージの確認に出す3行（docs/design.md の「マージの確認」）。ターミナルの出力のように並べる */
export function mergeResultLines(merge: MergeSummary): string[] {
  const review =
    merge.review === "clean"
      ? "✓ review  指摘なし"
      : merge.review === "issues"
        ? "× review  指摘あり"
        : "– review  未実施";
  return [`✓ check   ${merge.ci.passed}/${merge.ci.total} 通過`, review, "→ deploy  マージ後にVercelが公開"];
}
