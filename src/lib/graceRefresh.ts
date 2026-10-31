import type { RepoResult } from "./github/types";
import { getIssueStatus, issueGraceEndsAt, shouldShowIssue } from "./status";

/** 猶予が終わる時刻の、どれだけ後に取り直すか（時計のずれで猶予の中のまま返ってこないように） */
export const GRACE_REFRESH_MARGIN_MS = 1000;

/** 全監視リポジトリで、猶予（PR作成待ち15分・未着手10分）の中にある物が次に終わる時刻（無ければ null） */
export function nextGraceEnd(results: RepoResult[], now: Date): Date | null {
  let earliest: Date | null = null;
  for (const result of results) {
    if (!result.ok) continue;
    const { data } = result;
    for (const issue of data.issues) {
      if (!shouldShowIssue(issue, data.pulls)) continue;
      const status = getIssueStatus(issue, data, now);
      const end = issueGraceEndsAt(issue, data.comments, status.grace, now);
      if (end && (!earliest || end < earliest)) earliest = end;
    }
  }
  return earliest;
}

/** 画面が取り直す時刻：猶予が終わる時刻の少し後 */
export function graceRefreshAt(end: Date): Date {
  return new Date(end.getTime() + GRACE_REFRESH_MARGIN_MS);
}
