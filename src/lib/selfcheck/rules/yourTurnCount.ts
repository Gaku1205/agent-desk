import { buildPipelineRows } from "../../pipeline";
import { issueKey, repoName, type Drift, type SelfcheckRule } from "../types";

/** 人間の番になっている物の、GitHub 側の言い方 */
function humanWait(stage: string, mergeWait: string | null): string | null {
  switch (stage) {
    case "stuck":
      return "止まっています（ai:stuck）";
    case "question":
      return "企画AIの質問に答えるのを待っています（ai:question）";
    case "factoryTalk":
      return "工場の相談に答えるのを待っています（factory:wait）";
    case "mergeWaiting":
      return mergeWait === "hold" ? "マージを待っています（ai:hold）" : null;
    default:
      return null;
  }
}

/**
 * your-turn-count：人間の番になっている物（止まった・質問・工場の相談・`ai:hold` のマージ待ち。答え済みは除く）があるのに、
 * Your turn の数が 0、またはその物が Your turn に出ていない
 */
export const yourTurnCount: SelfcheckRule = {
  name: "your-turn-count",
  check({ results, now, screen }) {
    const inTurn = new Set(screen.turnItems.map((item) => `${item.owner}/${item.repo}#${item.issue.number}`));
    const drifts: Drift[] = [];
    for (const result of results) {
      const full = repoName(result);
      for (const row of buildPipelineRows(result.data, now, full)) {
        if (row.issue.state !== "open" || row.status.turn !== "human") continue;
        const actual = humanWait(row.status.stage, row.status.mergeWait);
        if (actual === null) continue;
        if (inTurn.has(issueKey(result, row.issue.number))) continue;
        drifts.push({
          repo: full,
          number: row.issue.number,
          rule: "your-turn-count",
          shown:
            screen.turnItems.length === 0
              ? "Your turn は 0件です"
              : `Your turn は ${screen.turnItems.length}件で、この物は入っていません`,
          actual,
        });
      }
    }
    return drifts;
  },
};
