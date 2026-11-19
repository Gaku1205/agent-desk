import { buildPipelineRows } from "../../pipeline";
import { issueKey, repoName, type Drift, type SelfcheckRule } from "../types";

const COUNTED_LABELS = ["ai:implement", "ai:review"];
/** パイプラインが動いている作業として数える段階（Slots の使用中に入るはずの物） */
const WORKING_STAGES = new Set(["implementing", "ciRunning", "reviewing", "fixing"]);

/**
 * slots-count：パイプラインが動いている作業として数える物（`ai:implement`・`ai:review` の開いている Issue で、動いている段階の物）が、
 * Slots の使用中に入っていない（使用中の数と違う。#649 の形）
 */
export const slotsCount: SelfcheckRule = {
  name: "slots-count",
  check({ results, now, screen }) {
    const inSlots = new Set(screen.lanes.works.map((work) => work.key));
    const drifts: Drift[] = [];
    for (const result of results) {
      const full = repoName(result);
      const issues = new Map(result.data.issues.map((issue) => [issue.number, issue]));
      const expected = buildPipelineRows(result.data, now, full).filter((row) => {
        const issue = issues.get(row.issue.number);
        if (!issue || issue.state !== "open") return false;
        if (!issue.labels.some((label) => COUNTED_LABELS.includes(label))) return false;
        return WORKING_STAGES.has(row.status.stage) || row.status.grace === "creatingPull";
      });
      if (expected.length === 0) continue;
      const used = screen.lanes.works.filter((work) => `${work.owner}/${work.repo}` === full).length;
      for (const row of expected) {
        if (inSlots.has(issueKey(result, row.issue.number))) continue;
        drifts.push({
          repo: full,
          number: row.issue.number,
          rule: "slots-count",
          shown: `Slots の使用中は ${used} 件で、この作業は入っていません`,
          actual: `動いている作業が ${expected.length} 件あります（この Issue は ${row.status.stage}）`,
        });
      }
    }
    return drifts;
  },
};
