import { describe, expect, it } from "vitest";
import { getProgress } from "../progress";
import { getIssueStatus, type Stage } from "../status";
import { buildTurnItems, turnItemKey, type OperationKind } from "../turn";
import { buildDemoResults, DEMO_PLAY_ISSUE, pressDemo } from "./data";
import { applyDemoOp, type DemoOp } from "./ops";
import { advancePlayback, restartPlayback, startPlayback, type DemoPlayback } from "./playback";

const NOW = new Date("2026-10-26T03:00:00Z");

function statusOf(playback: DemoPlayback, repo: string, number: number) {
  const result = buildDemoResults(NOW, playback).find((r) => r.repo === repo);
  if (!result || !result.ok) throw new Error("no repo");
  const issue = result.data.issues.find((i) => i.number === number);
  if (!issue) throw new Error("no issue");
  return getIssueStatus(issue, result.data, new Date(playback.now));
}

function press(repo: string, number: number, kind: OperationKind, from = startPlayback(NOW)): DemoPlayback {
  return pressDemo(from, { owner: "demo", repo, number }, kind);
}

function inTurn(playback: DemoPlayback, repo: string, number: number): boolean {
  return buildTurnItems(buildDemoResults(NOW, playback), new Date(playback.now)).some(
    (item) => turnItemKey(item) === `demo/${repo}#${number}`,
  );
}

describe("デモで押した操作", () => {
  const cases: { name: string; repo: string; number: number; kind: OperationKind; before: Stage; after: Stage; at: number }[] = [
    { name: "おまかせ → 清書中", repo: "todo-app", number: 13, kind: "plan", before: "notStarted", after: "planning", at: 0 },
    { name: "実装を依頼 → AIが実装中", repo: "todo-app", number: 13, kind: "implement", before: "notStarted", after: "implementing", at: 1 },
    { name: "始める → 清書中", repo: "todo-app", number: 31, kind: "start", before: "skipped", after: "planning", at: 0 },
    { name: "再開 → 修正を確認中（CIをやり直す）", repo: "todo-app", number: 23, kind: "resume", before: "stuck", after: "ciRunning", at: 5 },
    { name: "PRを作る → CI 実行中", repo: "landing-page", number: 7, kind: "createPull", before: "prWaiting", after: "ciRunning", at: 3 },
    { name: "レビューを依頼 → レビュー中", repo: "todo-app", number: 21, kind: "requestReview", before: "mergeWaiting", after: "reviewing", at: 4 },
    { name: "マージ → 公開中", repo: "todo-app", number: 22, kind: "merge", before: "mergeWaiting", after: "deploying", at: 7 },
  ];

  for (const c of cases) {
    it(`${c.name}：段階が進み、あなたの番から外れる`, () => {
      const start = startPlayback(NOW);
      expect(statusOf(start, c.repo, c.number).stage).toBe(c.before);
      expect(inTurn(start, c.repo, c.number)).toBe(true);
      const after = press(c.repo, c.number, c.kind, start);
      const status = statusOf(after, c.repo, c.number);
      expect(status.stage).toBe(c.after);
      expect(status.turn).not.toBe("human");
      expect(getProgress(status).at).toBe(c.at);
      expect(inTurn(after, c.repo, c.number)).toBe(false);
    });
  }

  it("PRを作ると、IssueとPRの番号と重ならない番号のPRができる", () => {
    const after = press("landing-page", 7, "createPull");
    const result = buildDemoResults(NOW, after).find((r) => r.repo === "landing-page");
    if (!result || !result.ok) throw new Error("no repo");
    const numbers = [...result.data.issues.map((i) => i.number), ...result.data.pulls.map((p) => p.number)];
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(statusOf(after, "landing-page", 7).pull?.number).toBe(Math.max(...numbers));
  });

  it("元のデータは変えない", () => {
    const result = buildDemoResults(NOW, startPlayback(NOW))[0];
    if (!result.ok) throw new Error("no repo");
    const op: DemoOp = { owner: "demo", repo: "todo-app", number: 13, kind: "plan", at: NOW.toISOString() };
    const next = applyDemoOp(result.data, op);
    expect(next).not.toBe(result.data);
    expect(result.data.issues.find((i) => i.number === 13)?.labels).toEqual([]);
  });

  it("無いIssueへの操作は何もしない", () => {
    const result = buildDemoResults(NOW, startPlayback(NOW))[0];
    if (!result.ok) throw new Error("no repo");
    const op: DemoOp = { owner: "demo", repo: "todo-app", number: 999, kind: "plan", at: NOW.toISOString() };
    expect(applyDemoOp(result.data, op)).toBe(result.data);
  });

  it("再生で進む1件のボタンは、再生を1段階進める", () => {
    let playback = startPlayback(NOW);
    while (statusOf(playback, DEMO_PLAY_ISSUE.repo, DEMO_PLAY_ISSUE.number).stage !== "prWaiting") {
      playback = advancePlayback(playback);
    }
    const after = press(DEMO_PLAY_ISSUE.repo, DEMO_PLAY_ISSUE.number, "createPull", playback);
    expect(after.step).toBe(playback.step + 1);
    expect(after.ops).toEqual([]);
    expect(statusOf(after, DEMO_PLAY_ISSUE.repo, DEMO_PLAY_ISSUE.number).stage).toBe("ciRunning");
  });

  it("押した操作は再生しても残り、「もう一度」で消える", () => {
    const pressed = press("todo-app", 13, "plan");
    const played = advancePlayback(pressed);
    expect(statusOf(played, "todo-app", 13).stage).toBe("planning");
    expect(restartPlayback(played).ops).toEqual([]);
  });
});
