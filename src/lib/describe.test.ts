import { describe, expect, it } from "vitest";
import { describeStatus, statusIconSpec } from "./describe";
import type { IssueStatus } from "./status";

function status(overrides: Partial<IssueStatus>): IssueStatus {
  return {
    stage: "notStarted",
    turn: "human",
    stageBeforeStuck: null,
    stageBeforeRetry: null,
    retry: null,
    pull: null,
    ci: { passed: 0, total: 0 },
    mergeWait: null,
    implementError: false,
    deployUnknown: false,
    stuckReason: null,
    holdRequest: null,
    planned: false,
    fixCount: 0,
    verifyingFix: false,
    ...overrides,
  };
}

describe("describeStatus", () => {
  const ci = { passed: 4, total: 4 };
  const cases: [string, Partial<IssueStatus>, string, string][] = [
    [
      "止まった",
      { stage: "stuck", stuckReason: "レビューの指摘が直りませんでした" },
      "レビューの指摘が直りませんでした。確認して、対応したら「再開」を押してください",
      "止まっています",
    ],
    [
      "やり直し待ち（回数あり）",
      {
        stage: "retrying",
        turn: "none",
        retry: { count: 3, max: 10, reason: "使用量の上限に達しました" },
      },
      "使用量の上限に達しました（3/10回）。時間をおいて自動でやり直します",
      "やり直し待ち 3/10回",
    ],
    [
      "やり直し待ち（回数なし）",
      { stage: "retrying", turn: "none" },
      "AIが止まりました。時間をおいて自動でやり直します",
      "やり直し待ち",
    ],
    [
      "保留",
      { stage: "skipped" },
      "保留中です。準備ができたら「始める」を押してください",
      "保留中",
    ],
    ["未着手", { stage: "notStarted" }, "まだ誰にも頼んでいません", "まだ頼んでいません"],
    [
      "順番待ち",
      { stage: "queued", turn: "none" },
      "前の作業が終わったら自動で始まります",
      "順番待ち",
    ],
    ["企画中", { stage: "planning", turn: "ai" }, "企画AIがIssueを清書中", "清書中"],
    ["AI作業中", { stage: "implementing", turn: "ai" }, "AIが実装中", "AIが実装中"],
    [
      "PR作成待ち",
      { stage: "prWaiting" },
      "AIの作業が終わりました。PRを作るとCIが走ります",
      "PRを作れます",
    ],
    [
      "PR作成待ち（エラー）",
      { stage: "prWaiting", implementError: true },
      "AIがエラーで止まりました。結果を確認してPRを作ってください",
      "AIがエラーで停止",
    ],
    [
      "CI中",
      { stage: "ciRunning", turn: "ai", ci: { passed: 2, total: 4 } },
      "CI 実行中 2/4",
      "CI 実行中 2/4",
    ],
    [
      "CI失敗",
      { stage: "ciFailed", turn: "ai" },
      "CIが失敗しました。AIに直してもらいます",
      "CIが失敗しました",
    ],
    ["レビュー中", { stage: "reviewing", turn: "ai" }, "レビューAIが確認中", "レビューAIが確認中"],
    [
      "修正の確認中（CI中）",
      { stage: "ciRunning", turn: "ai", ci: { passed: 3, total: 4 }, verifyingFix: true },
      "直した結果を確認中（CI 3/4・レビュー）",
      "修正を確認中",
    ],
    [
      "修正の確認中（レビュー中）",
      { stage: "reviewing", turn: "ai", ci, verifyingFix: true },
      "直した結果を確認中（CI 4/4・レビュー）",
      "修正を確認中",
    ],
    [
      "マージ待ち（hold）",
      { stage: "mergeWaiting", mergeWait: "hold", ci },
      "CI 4/4 通過・マージできます",
      "マージできます",
    ],
    [
      "マージ待ち（hold・PRの説明のお願いあり）",
      { stage: "mergeWaiting", mergeWait: "hold", ci, holdRequest: "マージの前に：秘密情報を登録（ほか2件）" },
      "マージの前に：秘密情報を登録（ほか2件）",
      "マージできます",
    ],
    [
      "止まった（理由の末尾に。がある）",
      { stage: "stuck", stuckReason: "依存を足してください。" },
      "依存を足してください。確認して、対応したら「再開」を押してください",
      "止まっています",
    ],
    [
      "マージ待ち（レビュー前）",
      { stage: "mergeWaiting", turn: "ai", mergeWait: "needsReview", ci },
      "CI 4/4 通過・レビューに回します",
      "レビューに回します",
    ],
    [
      "マージ待ち（自動マージ）",
      { stage: "mergeWaiting", turn: "ai", mergeWait: "autoMerge", ci },
      "CIもレビューもOK・自動でマージします",
      "自動でマージします",
    ],
    ["公開中", { stage: "deploying", turn: "none" }, "本番に公開中", "本番に公開中"],
    ["公開失敗", { stage: "deployFailed" }, "公開に失敗しました", "公開に失敗しました"],
    ["公開済み", { stage: "deployed", turn: "none" }, "本番に公開済み", "公開済み"],
    [
      "公開済み（不明）",
      { stage: "deployed", turn: "none", deployUnknown: true },
      "公開状況は不明",
      "公開状況は不明",
    ],
  ];

  it.each(cases)("%s", (_name, overrides, long, short) => {
    expect(describeStatus(status(overrides))).toEqual({ long, short });
  });

  it("修正中は回数と理由を出す", () => {
    const fixing = status({ stage: "fixing", turn: "ai", fixCount: 2 });
    expect(describeStatus(fixing, { fixReason: "レビューの指摘" })).toEqual({
      long: "AIが直しています（2/2 回目）：レビューの指摘",
      short: "AIが修正中 2/2",
    });
    expect(describeStatus(fixing).long).toBe("AIが直しています（2/2 回目）");
  });
});

describe("statusIconSpec", () => {
  it("形と色が段階で決まる", () => {
    expect(statusIconSpec(status({ stage: "notStarted" }))).toMatchObject({
      shape: "dashed",
      tone: "human",
    });
    expect(statusIconSpec(status({ stage: "queued", turn: "none" }))).toMatchObject({
      shape: "dashed",
      tone: "idle",
    });
    expect(statusIconSpec(status({ stage: "retrying", turn: "none" }))).toMatchObject({
      shape: "dashed",
      tone: "idle",
    });
    expect(statusIconSpec(status({ stage: "stuck" }))).toMatchObject({
      shape: "cross",
      tone: "human",
    });
    expect(statusIconSpec(status({ stage: "ciFailed", turn: "ai" }))).toMatchObject({
      shape: "cross",
      tone: "fail",
    });
    expect(statusIconSpec(status({ stage: "deployFailed" }))).toMatchObject({
      shape: "cross",
      tone: "fail",
    });
    expect(statusIconSpec(status({ stage: "prWaiting" }))).toMatchObject({
      shape: "half",
      tone: "human",
    });
    expect(statusIconSpec(status({ stage: "deployed", turn: "none" }))).toMatchObject({
      shape: "check",
      tone: "done",
    });
  });

  it("マージ待ちは誰の番かで色が変わる", () => {
    expect(statusIconSpec(status({ stage: "mergeWaiting", turn: "human" })).tone).toBe("human");
    expect(statusIconSpec(status({ stage: "mergeWaiting", turn: "ai" })).tone).toBe("ai");
  });

  it("回るのはAI作業中だけ", () => {
    expect(statusIconSpec(status({ stage: "implementing", turn: "ai" })).spinning).toBe(true);
    expect(statusIconSpec(status({ stage: "planning", turn: "ai" })).spinning).toBe(false);
  });
});
