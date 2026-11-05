import { describe, expect, it } from "vitest";
import { composeFactoryAnswer } from "../factoryTalk";
import { getProgress } from "../progress";
import { getIssueStatus, type Stage } from "../status";
import { buildTurnItems, turnItemKey, type OperationKind } from "../turn";
import { buildDemoResults, createDemoIssue, DEMO_PLAY_ISSUE, pressDemo } from "./data";
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
    { name: "答えを送る → 清書中", repo: "landing-page", number: 18, kind: "answer", before: "question", after: "planning", at: 0 },
  ];

  it("答えを送る：答えの文が、人のコメントとしてIssueに付く", () => {
    const after = pressDemo(startPlayback(NOW), { owner: "demo", repo: "landing-page", number: 18 }, "answer", "A。Q1はA（落ち着いた夜の色）");
    const result = buildDemoResults(NOW, after).find((r) => r.repo === "landing-page");
    if (!result || !result.ok) throw new Error("no repo");
    const last = result.data.comments.filter((c) => c.issueNumber === 18).at(-1);
    expect(last?.body).toBe("A。Q1はA（落ち着いた夜の色）");
    expect(last?.author.endsWith("[bot]")).toBe(false);
  });

  it("工場の相談：案 → 見た目の方向 → 画面 → 最終確認と進み、作るで閉じる（全部ちがうは同じ段階の出し直し）", () => {
    const target = { owner: "demo", repo: "landing-page", number: 19 };
    const factoryItem = (playback: ReturnType<typeof startPlayback>) =>
      buildTurnItems(buildDemoResults(NOW, playback), NOW).find((i) => turnItemKey(i) === "demo/landing-page#19");
    let playback = startPlayback(NOW);
    const stages: (string | null | undefined)[] = [];
    const answer = (input: Parameters<typeof composeFactoryAnswer>[1]) => {
      const item = factoryItem(playback);
      if (!item?.factory) throw new Error("no factory");
      playback = pressDemo(playback, target, "answer", composeFactoryAnswer(item.factory, input));
    };
    const empty = { redoNote: "", answers: {}, note: "" };
    stages.push(factoryItem(playback)?.factory?.stage);
    expect(factoryItem(playback)?.status.stage).toBe("factoryTalk");
    expect(factoryItem(playback)?.factory?.choices).toHaveLength(3);
    answer({ ...empty, pick: "1", answers: { 1: { choice: "A", note: "" } } });
    stages.push(factoryItem(playback)?.factory?.stage);
    expect(factoryItem(playback)?.factory?.choices.map((c) => c.images.map((i) => i.src))).toEqual([
      ["/factory/look-1.svg"],
      ["/factory/look-2.svg"],
      ["/factory/look-3.svg"],
    ]);
    answer({ ...empty, pick: "redo", redoNote: "もっと明るく" });
    stages.push(factoryItem(playback)?.factory?.stage);
    answer({ ...empty, pick: "2" });
    stages.push(factoryItem(playback)?.factory?.stage);
    answer({ ...empty, pick: "b" });
    stages.push(factoryItem(playback)?.factory?.stage);
    expect(factoryItem(playback)?.factory?.confirm?.images.map((i) => i.src)).toEqual([
      "/mockups/b-pc.svg",
      "/mockups/b-mobile.svg",
    ]);
    expect(factoryItem(playback)?.factory?.confirm?.facts.find((f) => f.label === "決まった事")?.value).toBe(
      "主に使う端末は？ → スマホが中心",
    );
    answer({ ...empty, pick: "go" });
    expect(stages).toEqual(["ideas", "looks", "looks", "mocks", "confirm"]);
    expect(factoryItem(playback)).toBeUndefined();
    const result = buildDemoResults(NOW, playback).find((r) => r.repo === "landing-page");
    if (!result || !result.ok) throw new Error("no repo");
    expect(result.data.issues.find((i) => i.number === 19)?.state).toBe("closed");
  });

  it("デモの質問は、質問と画面案（A・B、PCとスマホ）が読める", () => {
    const item = buildTurnItems(buildDemoResults(NOW, startPlayback(NOW)), NOW).find(
      (i) => turnItemKey(i) === "demo/landing-page#18",
    );
    expect(item?.question?.questions.map((q) => q.options.length)).toEqual([2, 2]);
    expect(item?.question?.mockups.map((m) => [m.letter, m.images.map((i) => i.device)])).toEqual([
      ["A", ["pc", "mobile"]],
      ["B", ["pc", "mobile"]],
    ]);
  });

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

describe("デモで書いたIssue", () => {
  it("選んだリポジトリにIssueが増える（番号は重ならず、ラベルは無く、未着手）", () => {
    const before = buildDemoResults(NOW, startPlayback(NOW)).find((r) => r.repo === "todo-app");
    if (!before || !before.ok) throw new Error("no repo");
    const used = [...before.data.issues.map((i) => i.number), ...before.data.pulls.map((p) => p.number)];
    const playback = createDemoIssue(startPlayback(NOW), { owner: "demo", repo: "todo-app" }, { title: "メモ", body: "" });
    const number = Math.max(...used) + 1;
    const status = statusOf(playback, "todo-app", number);
    expect(status.stage).toBe("notStarted");
    expect(inTurn(playback, "todo-app", number)).toBe(true);
    const after = buildDemoResults(NOW, playback).find((r) => r.repo === "todo-app");
    expect(after && after.ok && after.data.issues.find((i) => i.number === number)?.labels).toEqual([]);
    // 別のリポジトリには増えない
    const other = buildDemoResults(NOW, playback).find((r) => r.repo === "landing-page");
    expect(other && other.ok && other.data.issues.some((i) => i.title === "メモ")).toBe(false);
  });

  it("「もう一度」で消える", () => {
    const playback = createDemoIssue(startPlayback(NOW), { owner: "demo", repo: "todo-app" }, { title: "メモ", body: "" });
    expect(restartPlayback(playback).ops).toEqual([]);
  });
});
