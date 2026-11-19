import { isLinkedPull, shouldShowIssue } from "../../status";
import { issueKey, repoName, type Drift, type SelfcheckRule } from "../types";

/** `ai:*`・`factory*` のラベルか */
function isPipelineLabel(label: string): boolean {
  return label.startsWith("ai:") || label.startsWith("factory");
}

/**
 * all-sections：`ai:*`・`factory*` のラベルが付いた開いている Issue と、ブランチ名が `claude/` で始まる開いている PR が、
 * Your turn・Slots & Queue・いまの様子のどの区画にも出ていない
 */
export const allSections: SelfcheckRule = {
  name: "all-sections",
  check({ results, screen }) {
    const shown = new Set<string>([
      ...screen.turnItems.map((item) => `${item.owner}/${item.repo}#${item.issue.number}`),
      ...screen.lanes.works.map((work) => work.key),
      ...screen.lanes.queue.map((entry) => entry.key),
      ...screen.lanes.paused.map((entry) => entry.key),
      ...screen.lanes.runs.flatMap((run) =>
        run.issueNumber === null ? [] : [`${run.owner}/${run.repo}#${run.issueNumber}`],
      ),
      ...screen.messages.map((message) => message.key),
    ]);
    const drifts: Drift[] = [];
    for (const result of results) {
      const { data } = result;
      for (const issue of data.issues) {
        if (issue.state !== "open" || !shouldShowIssue(issue, data.pulls)) continue;
        if (!issue.labels.some(isPipelineLabel)) continue;
        if (shown.has(issueKey(result, issue.number))) continue;
        drifts.push({
          repo: repoName(result),
          number: issue.number,
          rule: "all-sections",
          shown: "Your turn・Slots & Queue・いまの様子のどこにも出ていません",
          actual: `開いている Issue で、ラベル ${issue.labels.filter(isPipelineLabel).join("・")} が付いています`,
        });
      }
      for (const pull of data.pulls) {
        if (pull.state !== "open" || !pull.headRef.startsWith("claude/")) continue;
        if (shown.has(issueKey(result, pull.number))) continue;
        const linkedShown = data.issues.some(
          (issue) => isLinkedPull(pull, issue.number) && shown.has(issueKey(result, issue.number)),
        );
        if (linkedShown) continue;
        drifts.push({
          repo: repoName(result),
          number: pull.number,
          rule: "all-sections",
          shown: "Your turn・Slots & Queue・いまの様子のどこにも出ていません",
          actual: `開いている PR で、ブランチ名が ${pull.headRef} です`,
        });
      }
    }
    return drifts;
  },
};
