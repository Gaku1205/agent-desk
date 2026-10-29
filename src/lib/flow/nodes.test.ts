import { describe, expect, it } from "vitest";
import { buildDemoResults } from "../demo/data";
import { startPlayback } from "../demo/playback";
import type { IssueStatus } from "../status";
import { buildFlowNodes, compareFlowNodes, countByStage, whoOf } from "./nodes";

const NOW = new Date("2026-10-26T03:00:00Z");

describe("whoOf", () => {
  const of = (stage: IssueStatus["stage"], turn: IssueStatus["turn"]) => whoOf({ stage, turn });
  it("公開済みは done、失敗は fail、待機は queue、それ以外は誰の番か", () => {
    expect(of("deployed", "none")).toBe("done");
    expect(of("ciFailed", "ai")).toBe("fail");
    expect(of("deployFailed", "human")).toBe("fail");
    expect(of("queued", "none")).toBe("queue");
    expect(of("retrying", "none")).toBe("queue");
    expect(of("stuck", "human")).toBe("human");
    expect(of("mergeWaiting", "human")).toBe("human");
    expect(of("mergeWaiting", "ai")).toBe("ai");
    expect(of("implementing", "ai")).toBe("ai");
    expect(of("deploying", "none")).toBe("ai");
  });
});

describe("buildFlowNodes", () => {
  const results = buildDemoResults(NOW, startPlayback(NOW));

  it("デモの全部の Issue が、段階の列（0〜7）と色を持つ", () => {
    const nodes = buildFlowNodes(results, NOW);
    expect(nodes.length).toBeGreaterThan(20);
    for (const node of nodes) {
      expect(node.at).toBeGreaterThanOrEqual(0);
      expect(node.at).toBeLessThanOrEqual(7);
      expect(node.key).toBe(`${node.owner}/${node.repo}#${node.number}`);
      expect(node.label).not.toBe("");
    }
    expect(nodes.filter((n) => n.who === "done").every((n) => n.at === 7)).toBe(true);
  });

  it("リポジトリで絞れる（大文字小文字は区別しない）", () => {
    const nodes = buildFlowNodes(results, NOW, { owner: "DEMO", repo: "Todo-App" });
    expect(nodes.length).toBeGreaterThan(5);
    expect(nodes.every((n) => n.repo === "todo-app")).toBe(true);
  });

  it("順番待ちの名札は、理由の Issue 番号を添える", () => {
    const nodes = buildFlowNodes(results, NOW);
    const queued = nodes.find((n) => n.repo === "todo-app" && n.number === 15);
    expect(queued?.who).toBe("queue");
    expect(queued?.label).toBe("順番待ち · #17 の後");
    expect(queued?.caption).toContain("#17");
  });

  it("止まった物は人間の番で、押す列にも出る", () => {
    const nodes = buildFlowNodes(results, NOW);
    const stuck = nodes.find((n) => n.repo === "todo-app" && n.number === 23);
    expect(stuck).toMatchObject({ who: "human", turn: true, label: "止まっています", at: 5 });
  });

  it("並びは 人間 → 失敗 → AI → 待機 → 公開済み、同じなら番号の大きい順", () => {
    const nodes = buildFlowNodes(results, NOW);
    const sorted = [...nodes].sort(compareFlowNodes);
    expect(sorted.map((n) => n.key)).toEqual(nodes.map((n) => n.key));
    const order = ["human", "fail", "ai", "queue", "done"];
    const ranks = nodes.map((n) => order.indexOf(n.who));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("段階ごとの件数は、全部足すと Issue の数", () => {
    const nodes = buildFlowNodes(results, NOW);
    const counts = countByStage(nodes);
    expect(counts).toHaveLength(8);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(nodes.length);
  });
});
