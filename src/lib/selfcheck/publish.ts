import type { Fetcher } from "../github/client";
import { commentIssue, createIssue, findOpenIssueByTitle } from "../github/selfcheckIssues";
import type { WatchedRepo } from "../config";
import {
  decideIssues,
  driftIssueTitle,
  formatDriftList,
  formatFixedComment,
  swapPreviousDrifts,
} from "./issues";
import type { SelfcheckReport } from "./run";

/**
 * 新しく点検した結果から、2回続けて出た決まりを Issue にし（開いた同題の Issue があればコメント）、直った決まりにコメントする。
 * 書けなくても（403 など）落ちない。呼ぶ側は返事を変えずに返す
 */
export async function publishDriftIssues(
  token: string,
  settingsRepo: WatchedRepo | null,
  scope: string,
  report: SelfcheckReport,
  fetcher: Fetcher = fetch,
): Promise<void> {
  const previous = swapPreviousDrifts(scope, report.drifts);
  if (!previous || !settingsRepo) return;
  const { raise, fixed } = decideIssues(previous, report.drifts);
  try {
    for (const rule of raise) {
      const title = driftIssueTitle(rule);
      const body = formatDriftList(rule, report.drifts, report.checkedAt);
      const existing = await findOpenIssueByTitle(token, settingsRepo, title, fetcher);
      if (!existing.ok) continue; // 一覧が読めなかったら、二重に立てないよう何もしない
      if (existing.number !== null) await commentIssue(token, settingsRepo, existing.number, body, fetcher);
      else await createIssue(token, settingsRepo, title, body, fetcher);
    }
    for (const rule of fixed) {
      const existing = await findOpenIssueByTitle(token, settingsRepo, driftIssueTitle(rule), fetcher);
      if (existing.ok && existing.number !== null) {
        await commentIssue(token, settingsRepo, existing.number, formatFixedComment(report.checkedAt), fetcher);
      }
    }
  } catch {
    // 書けなくても点検の返事は返す
  }
}
