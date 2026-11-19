import type { RepoResult } from "./github/types";

/** 表示のずれの Issue の題名の始まり（全角のコロン） */
export const DRIFT_TITLE_PREFIX = "表示のずれ：";

export type DriftSummary = {
  /** 開いている表示のずれの Issue の数 */
  count: number;
  /** 作られた時刻がいちばん新しい1件の URL（0件なら null） */
  url: string | null;
};

/**
 * 取り込み済みの結果から、開いている表示のずれの Issue を数える。
 * 数だけでなく、作られた時刻がいちばん新しい1件の URL も返す（押した先）。読めなかったリポジトリは数えない
 */
export function summarizeDriftIssues(results: RepoResult[]): DriftSummary {
  let count = 0;
  let latest: { createdAt: string; url: string } | null = null;
  for (const result of results) {
    if (!result.ok) continue;
    for (const issue of result.data.issues) {
      if (issue.state !== "open" || !issue.title.startsWith(DRIFT_TITLE_PREFIX)) continue;
      count += 1;
      if (latest === null || issue.createdAt > latest.createdAt) {
        latest = { createdAt: issue.createdAt, url: issue.url };
      }
    }
  }
  return { count, url: latest?.url ?? null };
}
