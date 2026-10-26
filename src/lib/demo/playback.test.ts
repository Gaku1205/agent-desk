import { describe, expect, it } from "vitest";
import { buildRecentEvents } from "../events";
import { getProgress } from "../progress";
import { getIssueStatus, type IssueStatus } from "../status";
import { buildTurnItems } from "../turn";
import { buildDemoResults, DEMO_PLAY_ISSUE } from "./data";
import {
  advancePlayback,
  isPlaybackDone,
  PLAY_INTERVAL_MS,
  PLAY_STEPS,
  playStep,
  restartPlayback,
  startPlayback,
  type DemoPlayback,
} from "./playback";

const NOW = new Date("2026-10-26T03:00:00Z");

function playStatus(playback: DemoPlayback): IssueStatus {
  const result = buildDemoResults(NOW, playback).find((r) => r.repo === DEMO_PLAY_ISSUE.repo);
  if (!result?.ok) throw new Error("取れていない");
  const issue = result.data.issues.find((i) => i.number === DEMO_PLAY_ISSUE.number);
  if (!issue) throw new Error("再生のIssueが無い");
  return getIssueStatus(issue, result.data, new Date(playback.now));
}

/** 最初から最後まで進めた、各段階の状態 */
function playAll(): DemoPlayback[] {
  const steps = [startPlayback(NOW)];
  while (!isPlaybackDone(steps.at(-1)!)) steps.push(advancePlayback(steps.at(-1)!));
  return steps;
}

describe("再生", () => {
  it("メモ（企画中）から始まる", () => {
    const playback = startPlayback(NOW);
    expect(playStep(playback)).toBe("planning");
    expect(playStatus(playback).stage).toBe("planning");
    expect(isPlaybackDone(playback)).toBe(false);
  });

  it("清書 → 実装 → PR → CI → レビュー → 修正 → マージ → 公開 と進み、公開済みで止まる", () => {
    const steps = playAll();
    expect(steps.map(playStep)).toEqual([...PLAY_STEPS]);
    expect(steps.map((p) => playStatus(p).stage)).toEqual([
      "planning",
      "implementing",
      "prWaiting",
      "ciRunning",
      "reviewing",
      "fixing",
      "ciRunning",
      "mergeWaiting",
      "deploying",
      "deployed",
    ]);
    // 進み具合のバー：清書(0)から公開(7)まで。修正の確認中は「修正」の位置のまま
    expect(steps.map((p) => getProgress(playStatus(p)).at)).toEqual([0, 1, 2, 3, 4, 5, 5, 6, 7, 7]);
    expect(getProgress(playStatus(steps.at(-1)!)).tone).toBe("done");
  });

  it("途中の状態：清書した・修正の確認中・自動でマージする直前", () => {
    const steps = playAll();
    const status = (name: (typeof PLAY_STEPS)[number]) =>
      playStatus(steps[PLAY_STEPS.indexOf(name)]);
    expect(status("planning").planned).toBe(false);
    expect(status("implementing").planned).toBe(true);
    expect(status("fixing").fixCount).toBe(1);
    expect(status("verifying").verifyingFix).toBe(true);
    expect(status("mergeWaiting").mergeWait).toBe("autoMerge");
    expect(status("deployed").deployUnknown).toBe(false);
  });

  it("1段階で4秒進み、最後まで行ったらそれ以上進まない", () => {
    const first = startPlayback(NOW);
    const second = advancePlayback(first);
    expect(Date.parse(second.now) - Date.parse(first.now)).toBe(PLAY_INTERVAL_MS);
    expect(second.times).toHaveLength(2);
    const last = playAll().at(-1)!;
    expect(advancePlayback(last)).toBe(last);
  });

  it("あなたの番と最近の出来事が、段階に合わせて変わる", () => {
    const steps = playAll();
    const inTurn = (p: DemoPlayback) =>
      buildTurnItems(buildDemoResults(NOW, p), new Date(p.now)).some(
        (item) => item.repo === DEMO_PLAY_ISSUE.repo && item.issue.number === DEMO_PLAY_ISSUE.number,
      );
    // PR作成待ちのときだけ、あなたの番に出る
    expect(steps.map(inTurn)).toEqual(steps.map((p) => playStep(p) === "prWaiting"));

    const last = steps.at(-1)!;
    const texts = buildRecentEvents(buildDemoResults(NOW, last), new Date(last.now))
      .filter((event) => event.id.startsWith(`demo/${DEMO_PLAY_ISSUE.repo}#${DEMO_PLAY_ISSUE.number}:`))
      .map((event) => event.text);
    expect(texts[0]).toBe("「期限が近いタスクを一覧の上に出す」が本番に公開されました");
    expect(texts).toContain("PRができました");
    expect(texts).toContain("AIに修正を依頼しました（1/2）");
  });

  it("「もう一度」で、今の時刻のまま最初に戻る", () => {
    const last = playAll().at(-1)!;
    const again = restartPlayback(last);
    expect(again.step).toBe(0);
    expect(again.now).toBe(last.now);
    expect(playStatus(again).stage).toBe("planning");
  });
});
