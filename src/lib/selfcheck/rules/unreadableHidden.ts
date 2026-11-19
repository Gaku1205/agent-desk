import type { Drift, SelfcheckRule } from "../types";

/**
 * unreadable-hidden：読めなかったリポジトリがあるのに、画面が「読めなかった」を出さずに数を出している（#612 の形）。
 * 画面に渡している結果に、読めなかったリポジトリの行が入っていない
 */
export const unreadableHidden: SelfcheckRule = {
  name: "unreadable-hidden",
  check({ unreadable, screen }) {
    if (unreadable.length === 0 || screen.unreadableShown > 0) return [];
    const drift: Drift = {
      repo: unreadable[0],
      number: 0,
      rule: "unreadable-hidden",
      shown: "読めなかったことを出さずに、数だけを出しています",
      actual: `読めなかったリポジトリが ${unreadable.length} 件あります（${unreadable.join("・")}）`,
    };
    return [drift];
  },
};
