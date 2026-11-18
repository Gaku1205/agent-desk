import { describe, expect, it } from "vitest";
import { buildExtendedBundle } from "./bundle";
import { convertExtendedNodes, isKeptComment, isKeptEvent, type ExtendedIssueNode, type ExtendedPullNode } from "./extended";

const NOW = new Date("2026-11-18T02:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

function issueNode(number: number, createdDaysAgo: number, extra: Partial<ExtendedIssueNode> = {}): ExtendedIssueNode {
  return { number, createdAt: ago(createdDaysAgo), updatedAt: ago(createdDaysAgo), comments: { nodes: [] }, timelineItems: { nodes: [] }, ...extra };
}

function pullNode(number: number, issueNumber: number, mergedDaysAgo: number | null, extra: Partial<ExtendedPullNode> = {}): ExtendedPullNode {
  return {
    number,
    body: `Closes #${issueNumber}`,
    headRefName: `claude/issue-${issueNumber}-x`,
    createdAt: ago(40),
    updatedAt: ago(mergedDaysAgo ?? 1),
    mergedAt: mergedDaysAgo === null ? null : ago(mergedDaysAgo),
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
    ...extra,
  };
}

const comment = (id: number, body: string, daysAgo: number) => ({ databaseId: id, body, createdAt: ago(daysAgo), author: { __typename: "Bot", login: "claude" } });

describe("30日分の取得結果 → RepoData に近い形", () => {
  it("目印のあるコメントだけ残す（進捗ログ・止まった理由・自動の修正依頼・自動のやり直し・清書AIのお願い）", () => {
    expect(isKeptComment("<!-- ai-step-log -->\n### 進捗ログ")).toBe(true);
    expect(isKeptComment("⏸ 自動で進めるのを止めました：CIが落ちました")).toBe(true);
    expect(isKeptComment("<!-- auto-fix -->")).toBe(true);
    expect(isKeptComment("<!-- auto-retry --> 1/3")).toBe(true);
    expect(isKeptComment("<!-- human-request -->\n許可をください")).toBe(true);
    expect(isKeptComment("ふつうのコメント")).toBe(false);
  });

  it("ラベルの出来事は ai:stuck・ai:queue の付け外しだけ残す", () => {
    const event = (name: string | null, kind = "labeled") => ({ event: kind, labelName: name, issueNumber: 1, createdAt: ago(1) });
    expect(isKeptEvent(event("ai:stuck"))).toBe(true);
    expect(isKeptEvent(event("ai:stuck", "unlabeled"))).toBe(true);
    expect(isKeptEvent(event("ai:queue"))).toBe(true);
    expect(isKeptEvent(event("ai:implement"))).toBe(false);
    expect(isKeptEvent(event("ai:stuck", "closed"))).toBe(false);
  });

  it("マージ済みPR（60日前より後）と Issue の作成時刻、目印のコメント、ai:stuck の出来事を持つ", () => {
    const data = convertExtendedNodes(
      "o",
      [
        issueNode(1, 20, {
          comments: { nodes: [comment(1, "<!-- ai-step-log -->\n", 20), comment(2, "雑談", 19)] },
          timelineItems: {
            nodes: [
              { __typename: "LabeledEvent", createdAt: ago(19), label: { name: "ai:stuck" } },
              { __typename: "LabeledEvent", createdAt: ago(19), label: { name: "ai:implement" } },
            ],
          },
        }),
        issueNode(1, 20), // 同じ番号は1件
      ],
      [pullNode(10, 1, 15), pullNode(11, 2, 61), pullNode(12, 3, null)],
      NOW,
    );
    expect(data.issues.map((issue) => issue.number)).toEqual([1]);
    expect(data.issues[0].createdAt).toBe(ago(20));
    expect(data.pulls.map((pull) => pull.number)).toEqual([10]);
    expect(data.pulls[0]).toMatchObject({ merged: true, headRef: "claude/issue-1-x", body: "Closes #1", mergedAt: ago(15) });
    expect(data.comments.map((c) => c.id)).toEqual([1]);
    expect(data.events.map((e) => e.labelName)).toEqual(["ai:stuck"]);
    expect(data.pullChecks).toEqual({});
  });

  it("進捗ログは、コメントの作成が60日前より前でも残す", () => {
    const data = convertExtendedNodes("o", [issueNode(1, 70, { comments: { nodes: [comment(1, "<!-- ai-step-log -->\n", 70)] } })], [], NOW);
    expect(data.comments).toHaveLength(1);
  });

  it("30d の集計：マージ・前の30日・リードタイム（Issue の作成 → マージ）・止まった回数", () => {
    const data = convertExtendedNodes(
      "o",
      [
        issueNode(1, 12, { timelineItems: { nodes: [{ __typename: "LabeledEvent", createdAt: ago(5), label: { name: "ai:stuck" } }] } }),
        issueNode(2, 40),
      ],
      [pullNode(10, 1, 10), pullNode(11, 2, 35)],
      NOW,
    );
    const bundle = buildExtendedBundle([{ owner: "o", repo: "r", ok: true, data }], NOW);
    expect(bundle.summary.merged).toBe(1);
    expect(bundle.summary.mergedPrev).toBe(1);
    expect(bundle.summary.leadMedianMs).toBe(2 * DAY);
    expect(bundle.summary.stopped).toBe(1);
    expect(bundle.now).toBe(NOW.toISOString());
  });

  it("開いたままのPRに付いた ai:stuck も、止まった回数に数える（PR は merged だけ）", () => {
    const stuck = { __typename: "LabeledEvent", createdAt: ago(0.1), label: { name: "ai:stuck" } };
    const data = convertExtendedNodes(
      "o",
      [],
      [pullNode(20, 5, null, { timelineItems: { nodes: [stuck] }, comments: { nodes: [comment(3, "⏸ 自動で進めるのを止めました：CIが落ちました", 0.1)] } })],
      NOW,
    );
    expect(data.pulls).toEqual([]);
    expect(data.events.map((e) => e.labelName)).toEqual(["ai:stuck"]);
    expect(data.comments.map((c) => c.id)).toEqual([3]);
    const bundle = buildExtendedBundle([{ owner: "o", repo: "r", ok: true, data }], NOW);
    expect(bundle.summary.stopped).toBe(1);
  });

  it("取れなかったリポジトリは数えず、全部取れなければ —（null）", () => {
    const failed = { owner: "o", repo: "r", ok: false as const, error: { kind: "other" as const, message: "x" } };
    expect(buildExtendedBundle([failed], NOW).summary.merged).toBeNull();
    const okData = convertExtendedNodes("o", [issueNode(1, 12)], [pullNode(10, 1, 10)], NOW);
    expect(buildExtendedBundle([failed, { owner: "o", repo: "s", ok: true, data: okData }], NOW).summary.merged).toBe(1);
  });
});
