import type { RepoData } from "./github/types";

// 「覚えている最後の結果」を書き直してよいかの判定（docs/spec.md の「全部のリポジトリを待つページ」）。
// 失敗・回数制限で止めた読みは、呼ぶ側で結果にならない（投げる）。ここでは、読めたが中身が空になった読みを見分ける。

/** 古い結果の時刻（ISO）を日本時間の `HH:MM` にする。読めなければ null */
export function formatStaleTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const jst = new Date(ms + 9 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

/** 覚えていた結果が出ているときの内容の時刻：その結果たちの読んだ時刻（無ければ「変わった」印）のうち、いちばん古い物 */
export function oldestReadAt(results: { data: RepoData; changeMark?: string }[]): string | null {
  const times = results
    .map((result) => result.data.sync?.readAt ?? result.changeMark ?? null)
    .filter((t): t is string => t !== null && !Number.isNaN(Date.parse(t)));
  if (times.length === 0) return null;
  return times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/**
 * 自動の取り直しで新しい段の列が来たとき、一度出した中身を残すか。
 * 新しい列の途中の段（覚えていた古い結果・一部のリポジトリだけ）は描かず、最後の段（`isFinal`）がそろうまで前の中身を出し続ける。
 * `shownFirst` は今出している中身が属する列（初めてなら、今の列と同じ）
 */
export function shouldHoldPrevious<T>(
  shownFirst: unknown,
  currentFirst: unknown,
  currentValue: T,
  isFinal: (value: T) => boolean,
): boolean {
  return shownFirst !== currentFirst && !isFinal(currentValue);
}

/** Issue も PR も1件も無いデータか */
export function isEmptyRepoData(data: RepoData): boolean {
  return data.issues.length === 0 && data.pulls.length === 0;
}

/**
 * 新しく読めた結果で、覚えている最後の結果（`previous`。無ければ null）を書き直してよいか。
 * - 中身が空の読みは、覚えている物が無いとき、または覚えている物が空でないときは覚えない
 *   （回数制限で読めなかった時間帯の空の結果を「最後の良い結果」にしないため）
 * - 本当に0件のリポジトリを読めた場合は、覚えている物も空のときだけ書き直す
 */
export function shouldRememberSnapshot(previous: RepoData | null, next: RepoData): boolean {
  if (!isEmptyRepoData(next)) return true;
  return previous !== null && isEmptyRepoData(previous);
}
