import type { MergeSummary } from "./turn";

/** マージの確認の1行（docs/design.md の「マージの確認」）。印・名前・結果の3列に分けて持つ（空白でそろえない） */
export type MergeLine = {
  mark: "✓" | "×" | "–" | "→";
  name: "check" | "review" | "deploy";
  text: string;
  /** ok：通った／warn：レビューが未実施・指摘あり（失敗の弱い色）／next：このあと起きること */
  tone: "ok" | "warn" | "next";
};

/** マージの確認に出す3行。ターミナルの出力のように並べるが、列は CSS の grid でそろえる */
export function mergeResultLines(merge: MergeSummary): MergeLine[] {
  const review: MergeLine =
    merge.review === "clean"
      ? { mark: "✓", name: "review", text: "指摘なし", tone: "ok" }
      : merge.review === "issues"
        ? { mark: "×", name: "review", text: "指摘あり", tone: "warn" }
        : { mark: "–", name: "review", text: "未実施", tone: "warn" };
  return [
    { mark: "✓", name: "check", text: `${merge.ci.passed}/${merge.ci.total} 通過`, tone: "ok" },
    review,
    { mark: "→", name: "deploy", text: "マージ後にVercelが公開", tone: "next" },
  ];
}

/** 「マージする」を弱める（塗りつぶさない）か：レビューが指摘なしで終わっていないとき */
export function isMergeWeak(merge: MergeSummary): boolean {
  return merge.review !== "clean";
}
