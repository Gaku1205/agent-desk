import { describe, expect, it } from "vitest";
import type { NotifyEvent } from "./notifyEvents";
import type { ParallelSettings } from "./parallel";
import {
  canStep,
  dueSave,
  formatSavedAt,
  needsParallelSave,
  notifyRowOn,
  notifyRowSummary,
  notifyScopeLabel,
  NOTIFY_ROWS,
  pickNightHour,
  planAutoAddWrite,
  planNotifyWrites,
  planParallelWrite,
  planWatchedReposWrite,
  queueSave,
  revertNotifyFailures,
  SAVE_DELAY_MS,
  setNotifyRepo,
  setNotifyRow,
  settleSave,
  stepCount,
  type NotifyRepo,
} from "./settingsSave";

const repo = (name: string, events: NotifyEvent[], pipeline = true): NotifyRepo => ({ name, pipeline, events });

describe("どの値をどこに書くか", () => {
  it("監視するリポジトリは SETTINGS_REPO の AGENT_DESK_WATCHED_REPOS にカンマ区切りで書く", () => {
    expect(planWatchedReposWrite(["o/a", "o/b"])).toEqual({
      ok: true,
      write: { where: "settingsRepo", variable: "AGENT_DESK_WATCHED_REPOS", value: "o/a,o/b", names: ["o/a", "o/b"] },
    });
  });

  it("0件になる外しは受け付けない", () => {
    expect(planWatchedReposWrite([])).toEqual({ ok: false, message: "監視するリポジトリを1つ以上選んでください" });
  });

  it("Auto-add は AGENT_DESK_AUTO_ADD に on / off", () => {
    expect(planAutoAddWrite(true)).toEqual({
      ok: true,
      write: { where: "settingsRepo", variable: "AGENT_DESK_AUTO_ADD", value: "on", on: true },
    });
    expect(planAutoAddWrite(false).ok && planAutoAddWrite(false)).toMatchObject({ write: { value: "off" } });
  });

  it("並列はパイプラインのあるリポジトリ全部に3つの Variable（既定と同じ・無しは消す）", () => {
    const result = planParallelWrite({ day: 5, night: 1, nightHours: { start: 23, end: 7 } });
    expect(result).toEqual({
      ok: true,
      write: {
        where: "pipelineRepos",
        settings: { day: 5, night: 1, nightHours: { start: 23, end: 7 } },
        writes: [
          { name: "PARALLEL_DAY", value: "5" },
          { name: "PARALLEL_NIGHT", value: null },
          { name: "PARALLEL_NIGHT_HOURS", value: "23-07" },
        ],
      },
    });
  });

  it("並列の夜の時間帯が同じ時刻なら書かない", () => {
    expect(planParallelWrite({ day: 3, night: 1, nightHours: { start: 4, end: 4 } })).toEqual({
      ok: false,
      message: "夜の時間帯の開始と終了は、違う時刻にしてください",
    });
  });
});

describe("通知（1行1種類）", () => {
  const repos = [
    repo("o/a", ["stuck", "question", "hold"]),
    repo("o/b", ["stuck", "manual"]),
    repo("o/c", ["deployed"], false),
  ];

  it("行は7つ。Merge は hold と manual をまとめる", () => {
    expect(NOTIFY_ROWS.map((row) => row.name)).toEqual([
      "Stuck",
      "Question",
      "Merge",
      "Deploy failed",
      "Deployed",
      "Auto-merged",
      "CI failed",
    ]);
    expect(NOTIFY_ROWS.find((row) => row.key === "merge")?.events).toEqual(["hold", "manual"]);
  });

  it("数えるのはパイプラインのあるリポジトリだけ。片方でも入っていれば鳴らす", () => {
    expect(notifyRowSummary(repos, "merge")).toEqual({ on: 2, total: 2 });
    expect(notifyRowSummary(repos, "question")).toEqual({ on: 1, total: 2 });
    expect(notifyRowSummary(repos, "deployed")).toEqual({ on: 0, total: 2 });
    expect(notifyRowOn(repos, "deployed")).toBe(false);
    expect(notifyScopeLabel(repos, "stuck")).toBe("全部");
    expect(notifyScopeLabel(repos, "question")).toBe("1 / 2");
  });

  it("スイッチをオンにすると、パイプラインのある全リポジトリに足す（無いリポジトリは変えない）", () => {
    const after = setNotifyRow(repos, "deployed", true);
    expect(after.map((r) => r.events)).toEqual([
      ["stuck", "question", "hold", "deployed"],
      ["stuck", "manual", "deployed"],
      ["deployed"],
    ]);
    const merge = setNotifyRow(repos, "merge", true);
    expect(merge[1].events).toEqual(["stuck", "hold", "manual"]);
  });

  it("スイッチをオフにすると全部から外す", () => {
    const after = setNotifyRow(repos, "merge", false);
    expect(after.map((r) => r.events)).toEqual([["stuck", "question"], ["stuck"], ["deployed"]]);
  });

  it("札を押すと、そのリポジトリだけ外す・足す", () => {
    const after = setNotifyRepo(repos, "stuck", "o/b", false);
    expect(after[0].events).toEqual(["stuck", "question", "hold"]);
    expect(after[1].events).toEqual(["manual"]);
    expect(notifyScopeLabel(after, "stuck")).toBe("1 / 2");
    expect(setNotifyRepo(repos, "stuck", "o/c", true)[2].events).toEqual(["deployed"]);
  });

  it("書くのは値が変わったリポジトリの NOTIFY_EVENTS だけ（決まった並び）", () => {
    const after = setNotifyRepo(repos, "ci_failed", "o/a", true);
    expect(planNotifyWrites(repos, after)).toEqual({
      ok: true,
      write: [
        {
          where: "o/a",
          variable: "NOTIFY_EVENTS",
          value: "stuck,question,hold,ci_failed",
          events: ["stuck", "question", "hold", "ci_failed"],
        },
      ],
    });
    expect(planNotifyWrites(repos, repos)).toEqual({ ok: true, write: [] });
  });

  it("0種類になるリポジトリが出る変更は書かない", () => {
    const after = setNotifyRow([repo("o/a", ["stuck"])], "stuck", false);
    expect(planNotifyWrites([repo("o/a", ["stuck"])], after)).toEqual({
      ok: false,
      message: "通知の種類を1つ以上選んでください",
    });
  });

  it("失敗したリポジトリだけ元に戻す", () => {
    const after = setNotifyRow(repos, "deployed", true);
    const settled = revertNotifyFailures(repos, after, ["o/b"]);
    expect(settled[0].events).toContain("deployed");
    expect(settled[1].events).toEqual(["stuck", "manual"]);
  });
});

describe("止まってから保存する", () => {
  it("続けて押した間は書かず、最後に押してから600ms止まったら最後の値だけ書く", () => {
    let pending = queueSave(4, 0);
    expect(dueSave(pending, 300)).toBeNull();
    pending = queueSave(5, 300);
    pending = queueSave(6, 500);
    expect(dueSave(pending, 1000)).toBeNull();
    expect(dueSave(pending, 500 + SAVE_DELAY_MS)).toBe(6);
    expect(dueSave(null, 9999)).toBeNull();
  });

  it("保存済みと同じ値なら書かない", () => {
    const saved: ParallelSettings = { day: 3, night: 1, nightHours: { start: 1, end: 8 } };
    expect(needsParallelSave(saved, { ...saved, nightHours: { start: 1, end: 8 } })).toBe(false);
    expect(needsParallelSave(saved, { ...saved, day: 4 })).toBe(true);
    expect(needsParallelSave(saved, { ...saved, nightHours: null })).toBe(true);
  });

  it("失敗したら保存済みに戻す", () => {
    expect(settleSave(3, 5, false)).toBe(3);
    expect(settleSave(3, 5, true)).toBe(5);
  });
});

describe("段階ボタンと帯", () => {
  it("1〜10 の間で1つずつ。10より大きい今の値は減らせるが増やせない", () => {
    expect(stepCount(3, 1)).toBe(4);
    expect(stepCount(1, -1)).toBe(1);
    expect(stepCount(10, 1)).toBe(10);
    expect(stepCount(12, 1)).toBe(12);
    expect(stepCount(12, -1)).toBe(11);
    expect(canStep(1, -1)).toBe(false);
    expect(canStep(10, 1)).toBe(false);
  });

  it("1回目は始まり、2回目で終わり。同じますは受け付けない", () => {
    expect(pickNightHour(null, 23)).toEqual({ kind: "anchor", anchor: 23 });
    expect(pickNightHour(23, 7)).toEqual({ kind: "picked", hours: { start: 23, end: 7 } });
    expect(pickNightHour(5, 5)).toEqual({ kind: "error", message: "夜の時間帯の開始と終了は、違う時刻にしてください" });
  });
});

describe("表示の文", () => {
  it("保存した時刻（日本時間の時:分）", () => {
    expect(formatSavedAt(null)).toBeNull();
    expect(formatSavedAt(new Date("2026-11-18T11:41:00Z"))).toBe("20:41 に保存しました");
  });
});
