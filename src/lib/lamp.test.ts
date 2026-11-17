import { describe, expect, it } from "vitest";
import type { CommentData, WorkflowRunData } from "./github/types";
import {
  assignLamps,
  hasOpenHumanRequest,
  isRelatedRun,
  judgeLamp,
  lampLabel,
  runActivity,
  type LampInput,
} from "./lamp";

const NOW = new Date("2026-11-16T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function input(over: Partial<LampInput> = {}): LampInput {
  return {
    labels: [],
    humanRequest: false,
    done: false,
    runs: { active: false, lastUpdatedAt: null },
    touchedAt: minutesAgo(60),
    now: NOW,
    ...over,
  };
}

function run(over: Partial<WorkflowRunData> = {}): WorkflowRunData {
  return { status: "completed", headBranch: "main", displayTitle: "", pullNumbers: [], updatedAt: minutesAgo(1), ...over };
}

describe("judgeLamp", () => {
  it("緑：関わる実行が実行中・待機中", () => {
    expect(judgeLamp(input({ labels: ["ai:implement"], runs: { active: true, lastUpdatedAt: minutesAgo(30) } }))).toBe(
      "running",
    );
  });

  it("緑：ai:retry（自動のやり直しの待ち時間）", () => {
    expect(judgeLamp(input({ labels: ["ai:implement", "ai:retry"] }))).toBe("running");
  });

  it("緑：CI失敗のあと自動で直している途中（実行が見えなくても）", () => {
    expect(judgeLamp(input({ labels: ["ai:implement"], autoFixing: true }))).toBe("running");
    expect(judgeLamp(input({ labels: ["ai:implement"], autoFixing: false }))).not.toBe("running");
  });

  it("ラベルだけでは緑にしない：進行中のラベルで、実行が10分以上動いていなければ赤", () => {
    expect(
      judgeLamp(input({ labels: ["ai:implement"], runs: { active: false, lastUpdatedAt: minutesAgo(10) }, touchedAt: minutesAgo(20) })),
    ).toBe("needsHuman");
    expect(judgeLamp(input({ labels: ["ai:plan"], runs: { active: false, lastUpdatedAt: null } }))).toBe("needsHuman");
  });

  it("進行中のラベルで、最後の動き（実行か Issue の変化）から10分たっていなければ何も出さない", () => {
    expect(
      judgeLamp(input({ labels: ["ai:review"], runs: { active: false, lastUpdatedAt: minutesAgo(9) } })),
    ).toBe("none");
    expect(
      judgeLamp(input({ labels: ["ai:implement"], runs: { active: false, lastUpdatedAt: null }, touchedAt: minutesAgo(2) })),
    ).toBe("none");
  });

  it("実行が取れなかったときは、緑にも「止まっているかも」の赤にもしない", () => {
    expect(judgeLamp(input({ labels: ["ai:implement"], runs: null }))).toBe("none");
  });

  it("赤：ai:stuck・ai:question・ai:hold・お願いのコメント", () => {
    for (const label of ["ai:stuck", "ai:question", "ai:hold"]) {
      expect(judgeLamp(input({ labels: [label] }))).toBe("needsHuman");
    }
    expect(judgeLamp(input({ humanRequest: true }))).toBe("needsHuman");
    expect(judgeLamp(input({ labels: ["ai:stuck"], runs: null }))).toBe("needsHuman");
  });

  it("紫：ai:queue・ai:blocked", () => {
    expect(judgeLamp(input({ labels: ["ai:queue"] }))).toBe("waiting");
    expect(judgeLamp(input({ labels: ["ai:blocked"] }))).toBe("waiting");
  });

  it("優先は 緑 > 赤 > 紫", () => {
    const active = { active: true, lastUpdatedAt: minutesAgo(1) };
    expect(judgeLamp(input({ labels: ["ai:stuck", "ai:queue"], runs: active }))).toBe("running");
    expect(judgeLamp(input({ labels: ["ai:stuck", "ai:queue"] }))).toBe("needsHuman");
    expect(judgeLamp(input({ labels: ["ai:queue"], humanRequest: true }))).toBe("needsHuman");
  });

  it("いま動いているなら緑（過去にエラーで止まった・お願いがあっても、最新の状態を優先）", () => {
    expect(
      judgeLamp(input({ labels: ["ai:implement"], humanRequest: true, runs: { active: true, lastUpdatedAt: minutesAgo(0) } })),
    ).toBe("running");
  });

  it("完了・公開済み・ラベルの無い物は何も出さない", () => {
    expect(judgeLamp(input({ labels: ["ai:implement"], done: true }))).toBe("none");
    expect(judgeLamp(input({ labels: ["ai:stuck"], done: true }))).toBe("none");
    expect(judgeLamp(input())).toBe("none");
  });
});

describe("assignLamps", () => {
  it("紫の数字は待っている物の中での位置（ai:queue の番号順、その後に ai:blocked）", () => {
    const lamps = assignLamps([
      { number: 9, labels: ["ai:queue"], kind: "waiting" },
      { number: 3, labels: ["ai:blocked"], kind: "waiting" },
      { number: 5, labels: ["ai:queue"], kind: "waiting" },
      { number: 7, labels: ["ai:queue"], kind: "running" },
      { number: 8, labels: [], kind: "none" },
    ]);
    expect(lamps.get(5)).toEqual({ kind: "waiting", position: 1 });
    expect(lamps.get(9)).toEqual({ kind: "waiting", position: 2 });
    expect(lamps.get(3)).toEqual({ kind: "waiting", position: 3 });
    expect(lamps.get(7)).toEqual({ kind: "running" });
    expect(lamps.get(8)).toEqual({ kind: "none" });
  });
});

describe("assignLamps：急ぎ（priority:high）", () => {
  it("ai:queue のうち priority:high が先（パイプラインが始める順）。その中は番号順", () => {
    const lamps = assignLamps([
      { number: 5, labels: ["ai:queue"], kind: "waiting" },
      { number: 12, labels: ["ai:queue", "priority:high"], kind: "waiting" },
      { number: 9, labels: ["priority:high", "ai:queue"], kind: "waiting" },
      { number: 7, labels: ["ai:queue"], kind: "waiting" },
    ]);
    expect(lamps.get(9)).toEqual({ kind: "waiting", position: 1 });
    expect(lamps.get(12)).toEqual({ kind: "waiting", position: 2 });
    expect(lamps.get(5)).toEqual({ kind: "waiting", position: 3 });
    expect(lamps.get(7)).toEqual({ kind: "waiting", position: 4 });
  });

  it("ai:blocked は priority:high でも、ai:queue の後ろのまま", () => {
    const lamps = assignLamps([
      { number: 3, labels: ["ai:blocked", "priority:high"], kind: "waiting" },
      { number: 8, labels: ["ai:queue"], kind: "waiting" },
    ]);
    expect(lamps.get(8)).toEqual({ kind: "waiting", position: 1 });
    expect(lamps.get(3)).toEqual({ kind: "waiting", position: 2 });
  });
});

describe("lampLabel", () => {
  it("読み上げとホバーの文言", () => {
    expect(lampLabel({ kind: "running" })).toBe("動作中");
    expect(lampLabel({ kind: "needsHuman" })).toBe("人間の手が必要");
    expect(lampLabel({ kind: "waiting", position: 2 })).toBe("順番待ち 2番目");
    expect(lampLabel({ kind: "none" })).toBeNull();
  });
});

describe("isRelatedRun・runActivity", () => {
  const pulls = [{ number: 40, headRef: "feature/x" }];

  it("ブランチ名・紐づく PR のブランチ・PR の番号・題名の番号で結びつける", () => {
    expect(isRelatedRun(run({ headBranch: "claude/issue-12-20261116" }), 12, [])).toBe(true);
    expect(isRelatedRun(run({ headBranch: "claude/issue-123-x" }), 12, [])).toBe(false);
    expect(isRelatedRun(run({ headBranch: "feature/x" }), 12, pulls)).toBe(true);
    expect(isRelatedRun(run({ pullNumbers: [40] }), 12, pulls)).toBe(true);
    expect(isRelatedRun(run({ displayTitle: "実装 #12" }), 12, [])).toBe(true);
    expect(isRelatedRun(run({ displayTitle: "実装 #120" }), 12, [])).toBe(false);
    expect(isRelatedRun(run({ displayTitle: "PR #40 のレビュー" }), 12, pulls)).toBe(true);
    expect(isRelatedRun(run(), 12, pulls)).toBe(false);
  });

  it("実行中・待機中があれば active、最後の更新はいちばん新しい updated_at", () => {
    const runs = [
      run({ headBranch: "claude/issue-12-a", updatedAt: minutesAgo(30) }),
      run({ headBranch: "claude/issue-12-a", status: "queued", updatedAt: minutesAgo(5) }),
      run({ headBranch: "claude/issue-99-a", status: "in_progress", updatedAt: minutesAgo(0) }),
    ];
    expect(runActivity(runs, 12, [])).toEqual({ active: true, lastUpdatedAt: minutesAgo(5) });
    expect(runActivity([runs[0]], 12, [])).toEqual({ active: false, lastUpdatedAt: minutesAgo(30) });
    expect(runActivity([], 12, [])).toEqual({ active: false, lastUpdatedAt: null });
  });

  it("実行が取れなかった（null・無し）ときは null", () => {
    expect(runActivity(null, 12, [])).toBeNull();
    expect(runActivity(undefined, 12, [])).toBeNull();
  });
});

describe("hasOpenHumanRequest", () => {
  const comment = (over: Partial<CommentData>): CommentData => ({
    id: 1,
    issueNumber: 12,
    author: "claude[bot]",
    body: "<!-- human-request -->\nSecrets を登録してください",
    createdAt: minutesAgo(30),
    ...over,
  });

  it("お願いのコメントがあり、そのあとに人のコメントが無い", () => {
    expect(hasOpenHumanRequest([comment({})], [12])).toBe(true);
  });

  it("そのあとに人がコメントしていれば、もう待っていない", () => {
    expect(hasOpenHumanRequest([comment({}), comment({ id: 2, author: "owner", body: "登録しました", createdAt: minutesAgo(10) })], [12])).toBe(false);
  });

  it("作者が claude[bot] でない・別の Issue のコメントは使わない", () => {
    expect(hasOpenHumanRequest([comment({ author: "someone" })], [12])).toBe(false);
    expect(hasOpenHumanRequest([comment({ issueNumber: 13 })], [12])).toBe(false);
  });
});
