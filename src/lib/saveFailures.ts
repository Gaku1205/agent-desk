/** 1つのリポジトリへの書き込みの失敗 */
export type SaveFailure = { name: string; message: string };

/** 画面に出す失敗の1行。`title` は、まとめたリポジトリ名の一覧 */
export type SaveFailureLine = { text: string; title?: string };

/**
 * 失敗を理由ごとに1行にまとめる（出てきた順）。
 * 同じ理由が2件以上なら `理由（n件）`（title にリポジトリ名）、1件なら `リポジトリ名：理由`。
 * 書こうとしたリポジトリが1つだけ（attempted ≤ 1）なら、理由だけ
 */
export function summarizeSaveFailures(
  failures: readonly SaveFailure[],
  attempted: number,
): SaveFailureLine[] {
  const groups = new Map<string, string[]>();
  for (const failure of failures) {
    const names = groups.get(failure.message);
    if (names) names.push(failure.name);
    else groups.set(failure.message, [failure.name]);
  }
  return [...groups].map(([message, names]) => {
    if (names.length > 1) return { text: `${message}（${names.length}件）`, title: names.join("、") };
    if (attempted <= 1) return { text: message };
    return { text: `${names[0]}：${message}` };
  });
}
