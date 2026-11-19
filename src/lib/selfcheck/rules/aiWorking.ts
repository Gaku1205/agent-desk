import type { RepoData } from "../../github/types";
import { isRelatedRun } from "../../lamp";
import { isLinkedPull } from "../../status";
import { repoName, type Drift, type OkResult, type SelfcheckRule } from "../types";

/** 「AI が作業中」と出してから、実行が無いと「ずれ」にするまで */
export const AI_WORKING_GRACE_MS = 30 * 60 * 1000;
/** 「待っている」と出してから、動いている実行があると「ずれ」にするまで */
export const WAITING_GRACE_MS = 5 * 60 * 1000;

/** 実行が無いと「ずれ」にする、AI が作業中の段階 */
const WORKING_STAGES = new Set(["implementing", "planning", "reviewing", "fixing"]);
const WAITING_STAGES = new Set(["question", "factoryTalk"]);

function ms(value: string | undefined | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function linked(data: RepoData, issueNumber: number) {
  return data.pulls.filter((pull) => isLinkedPull(pull, issueNumber));
}

/** その Issue（と紐づく PR）の、ラベル・コメント・本体のいちばん新しい更新時刻（ミリ秒） */
export function lastTouchedMs(data: RepoData, issueNumber: number): number {
  const pulls = linked(data, issueNumber);
  const numbers = new Set([issueNumber, ...pulls.map((pull) => pull.number)]);
  let latest = ms(data.issues.find((issue) => issue.number === issueNumber)?.updatedAt);
  for (const pull of pulls) latest = Math.max(latest, ms(pull.updatedAt));
  for (const event of data.events) {
    if (event.issueNumber !== null && numbers.has(event.issueNumber)) latest = Math.max(latest, ms(event.createdAt));
  }
  for (const comment of data.comments) {
    if (numbers.has(comment.issueNumber)) latest = Math.max(latest, ms(comment.updatedAt ?? comment.createdAt));
  }
  return latest;
}

function relatedRuns(result: OkResult, issueNumber: number) {
  const pulls = linked(result.data, issueNumber);
  return (result.data.runs ?? []).filter((run) => isRelatedRun(run, issueNumber, pulls));
}

/**
 * ai-working：（a）「AI が作業中」と出している物に、動いている Actions の実行が無い（30分以上）。
 * （b）動いている実行があるのに、Your turn で「待っている」と出している。実行が取れていないリポジトリは判定しない
 */
export const aiWorking: SelfcheckRule = {
  name: "ai-working",
  check({ results, now, screen }) {
    const drifts: Drift[] = [];
    const byKey = new Map(results.map((result) => [`${result.owner}/${result.repo}`, result]));
    for (const message of screen.messages) {
      if (!WORKING_STAGES.has(message.stage)) continue;
      const result = byKey.get(`${message.owner}/${message.repo}`);
      if (!result || !Array.isArray(result.data.runs)) continue;
      const active = relatedRuns(result, message.number).some(
        (run) => run.status === "in_progress" || run.status === "queued",
      );
      if (active) continue;
      const elapsed = now.getTime() - lastTouchedMs(result.data, message.number);
      if (elapsed < AI_WORKING_GRACE_MS) continue;
      drifts.push({
        repo: repoName(result),
        number: message.number,
        rule: "ai-working",
        shown: `AI が作業中と出ています（${message.text}）`,
        actual: `動いている Actions の実行がありません（最後の更新から${Math.floor(elapsed / 60000)}分）`,
      });
    }
    for (const item of screen.turnItems) {
      if (!WAITING_STAGES.has(item.status.stage)) continue;
      const result = byKey.get(`${item.owner}/${item.repo}`);
      if (!result || !Array.isArray(result.data.runs)) continue;
      const running = relatedRuns(result, item.issue.number).find((run) => run.status === "in_progress");
      if (!running) continue;
      if (now.getTime() - ms(item.waitingSince) < WAITING_GRACE_MS) continue;
      drifts.push({
        repo: repoName(result),
        number: item.issue.number,
        rule: "ai-working",
        shown: `Your turn で${item.status.stage === "factoryTalk" ? "工場の相談待ち" : "質問待ち"}と出ています`,
        actual: `Actions の実行が動いています（${running.name ?? "実行"}）`,
      });
    }
    return drifts;
  },
};
