import { describe, expect, it } from "vitest";
import { buildConversation, chatCi, chatLine, compareMessages, queueAfterNumber, type ChatMessage } from "./conversation";
import { buildDemoResults } from "./demo/data";
import { startPlayback } from "./demo/playback";
import { buildTrailEvents } from "./events";
import type { IssueStatus } from "./status";
import { buildTurnItems, turnItemKey } from "./turn";

const NOW = new Date("2026-10-26T03:00:00Z");

function status(overrides: Partial<IssueStatus>): IssueStatus {
  return {
    stage: "notStarted",
    turn: "ai",
    stageBeforeStuck: null,
    stageBeforeRetry: null,
    retry: null,
    pull: null,
    ci: { passed: 3, total: 4 },
    mergeWait: null,
    implementError: false,
    deployUnknown: false,
    stuckReason: null,
    holdRequest: null,
    planned: true,
    fixCount: 1,
    verifyingFix: false,
    reviewedClean: false,
    grace: null,
    ...overrides,
  };
}

describe("chatLine（コンフリクト）", () => {
  const conflictPull = { conflicting: true } as NonNullable<IssueStatus["pull"]>;

  it("マージ待ちでコンフリクトなら、自動でマージしますを出さない", () => {
    for (const mergeWait of ["autoMerge", "needsReview"] as const) {
      expect(chatLine(status({ stage: "mergeWaiting", mergeWait, pull: conflictPull }))).toEqual({
        speaker: "パイプライン",
        text: "main とぶつかっています",
      });
    }
  });

  it("修正の依頼が出ているときは、AIが解消しますを付ける", () => {
    expect(chatLine(status({ stage: "fixing", pull: conflictPull }))).toEqual({
      speaker: "AI",
      text: "main とぶつかっています。AIが解消します",
    });
  });

  it("コンフリクトでなければ今までどおり", () => {
    expect(
      chatLine(status({ stage: "mergeWaiting", mergeWait: "autoMerge", pull: { conflicting: false } as NonNullable<IssueStatus["pull"]> })).text,
    ).toBe("CIもレビューもOKです。まもなく自動でマージします");
  });
});

describe("chatCi（CI の線と数）", () => {
  it("通常の CI 中は、席の行と同じ文（枠待ちがあれば枠待ち）", () => {
    const ci = { passed: 4, total: 10, running: 0, queued: 6, failed: 0 };
    const line = chatLine(status({ stage: "ciRunning", ci }));
    expect(line.text).toBe("4/7 CI ✓4 ⧗6 枠待ち");
    expect(chatCi(status({ stage: "ciRunning", ci }))?.counts).toEqual({ passed: 4, running: 0, queued: 6, failed: 0, total: 10 });
  });

  it("未報告の必須チェックが枠待ちに入った数も、そのまま文に出る", () => {
    const ci = { passed: 4, total: 6, running: 0, queued: 2, failed: 0 };
    expect(chatLine(status({ stage: "ciRunning", ci })).text).toBe("4/7 CI ✓4 ⧗2 枠待ち");
  });

  it("直した結果の確認中・CI 以外は null", () => {
    expect(chatCi(status({ stage: "ciRunning", verifyingFix: true }))).toBeNull();
    expect(chatCi(status({ stage: "reviewing" }))).toBeNull();
  });
});

describe("chatLine", () => {
  it("AIの番の段階は「〇〇が△△しています」の形（頭に「いま」を付けない）", () => {
    expect(chatLine(status({ stage: "planning" }))).toEqual({ speaker: "企画AI", text: "企画AIがIssueを清書しています" });
    expect(chatLine(status({ stage: "implementing" }))).toEqual({ speaker: "AI", text: "AIが実装しています" });
    expect(chatLine(status({ stage: "ciRunning" }))).toEqual({ speaker: "CI", text: "4/7 CI ✓3 ◌1 実行中" });
    expect(chatLine(status({ stage: "reviewing" }))).toEqual({ speaker: "レビューAI", text: "レビューAIが確認しています" });
    expect(chatLine(status({ stage: "fixing", fixCount: 2 }))).toEqual({ speaker: "AI", text: "AIが直しています（2/3 回目）" });
    expect(chatLine(status({ stage: "fixing", fixCount: 3 }))).toEqual({ speaker: "AI", text: "AIが直しています（3/3 回目）" });
    expect(chatLine(status({ stage: "fixing", fixCount: 5 }))).toEqual({ speaker: "AI", text: "AIが直しています（3/3 回目）" });
    expect(chatLine(status({ stage: "fixing", fixCount: 1, fixLimit: 4 }))).toEqual({ speaker: "AI", text: "AIが直しています（1/4 回目）" });
    expect(chatLine(status({ stage: "ciFailed", fixCount: 1 }))).toEqual({ speaker: "AI", text: "AIが直しています（2/3 回目）" });
    expect(chatLine(status({ stage: "ciFailed", fixCount: 3 }))).toEqual({
      speaker: "CI",
      text: "CIが失敗しました。修正の上限に達しました",
    });
    expect(chatLine(status({ stage: "deploying", turn: "none" }))).toEqual({ speaker: "本番", text: "本番に公開しています" });
  });

  it("修正の確認中は、CIとレビューで確かめている文", () => {
    const text = "直した結果を、CIとレビューで確かめています（CI 3/4）";
    expect(chatLine(status({ stage: "ciRunning", verifyingFix: true })).text).toBe(text);
    expect(chatLine(status({ stage: "reviewing", verifyingFix: true })).text).toBe(text);
  });

  it("マージ待ち（AI）は、自動マージかレビューに回すか", () => {
    expect(chatLine(status({ stage: "mergeWaiting", mergeWait: "autoMerge", ci: { passed: 4, total: 4 } })).text).toBe(
      "CIもレビューもOKです。まもなく自動でマージします",
    );
    expect(chatLine(status({ stage: "mergeWaiting", mergeWait: "needsReview", ci: { passed: 4, total: 4 } })).text).toBe(
      "CIが通りました（4/4）。このあとレビューに回します",
    );
  });

  it("順番待ちは、理由に番号があれば「#17 の後」を添える", () => {
    expect(chatLine(status({ stage: "queued", turn: "none" }), { queueAfter: 17 }).text).toBe(
      "前の作業が終わるのを待っています（#17 の後）",
    );
    expect(chatLine(status({ stage: "queued", turn: "none" })).text).toBe("前の作業が終わるのを待っています");
  });

  it("公開済みは、不明なら分からないと言う", () => {
    expect(chatLine(status({ stage: "deployed", turn: "none" })).text).toBe("本番に公開しました");
    expect(chatLine(status({ stage: "deployed", turn: "none", deployUnknown: true })).text).toBe(
      "マージしました。公開状況は分かりません",
    );
  });

  it("猶予の間はパイプラインの番", () => {
    expect(chatLine(status({ stage: "notStarted", grace: "intake" }))).toEqual({
      speaker: "パイプライン",
      text: "パイプラインの受付が、企画に回すか決めています",
    });
    expect(chatLine(status({ stage: "prWaiting", grace: "creatingPull" })).text).toBe(
      "AIの作業が終わりました。パイプラインがPRを作っています",
    );
  });

  it("やり直し待ちは、理由と回数の説明文", () => {
    const line = chatLine(status({ stage: "retrying", turn: "none", retry: { count: 2, max: 10, reason: "利用上限" } }));
    expect(line.speaker).toBe("パイプライン");
    expect(line.text).toBe("利用上限（2/10回）。時間をおいて自動でやり直します");
  });
});

describe("queueAfterNumber", () => {
  it("理由の中の最初の Issue 番号", () => {
    expect(queueAfterNumber("#17 が終わってから始めます")).toBe(17);
    expect(queueAfterNumber("前の作業の後")).toBeNull();
    expect(queueAfterNumber(null)).toBeNull();
  });
});

describe("compareMessages", () => {
  const message = (key: string, number: number, latestAt: string | null) => ({ key, number, latestAt }) as ChatMessage;
  it("上が古く下が新しい：出来事が無い物は番号の小さい順でいちばん上、出来事がある物は古い順", () => {
    const list = [
      message("a#1", 1, null),
      message("a#2", 2, "2026-10-26T01:00:00Z"),
      message("a#3", 3, null),
      message("a#4", 4, "2026-10-26T02:00:00Z"),
    ].sort(compareMessages);
    expect(list.map((m) => m.key)).toEqual(["a#1", "a#3", "a#2", "a#4"]);
  });

  it("同じ時刻なら、キーの順で安定する", () => {
    const list = [message("b#1", 1, "2026-10-26T01:00:00Z"), message("a#2", 2, "2026-10-26T01:00:00Z")].sort(
      compareMessages,
    );
    expect(list.map((m) => m.key)).toEqual(["a#2", "b#1"]);
  });
});

describe("buildConversation（デモのデータ）", () => {
  const results = buildDemoResults(NOW, startPlayback(NOW));
  const events = buildTrailEvents(results, NOW);
  const messages = buildConversation(results, events, NOW);

  it("「あなたの番」に出る Issue は会話に出さない", () => {
    const turnKeys = new Set(buildTurnItems(results, NOW).map(turnItemKey));
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(turnKeys.has(message.key)).toBe(false);
  });

  it("公開済みには印が付き、AIの番の物も入る", () => {
    expect(messages.some((m) => m.deployed)).toBe(true);
    expect(messages.some((m) => m.stage === "implementing")).toBe(true);
    for (const m of messages) expect(m.deployed).toBe(m.stage === "deployed");
  });

  it("新しい出来事がある物が下に並ぶ（上が古い）", () => {
    const withTime = messages.filter((m) => m.latestAt !== null).map((m) => m.latestAt as string);
    expect(withTime).toEqual([...withTime].sort());
  });

  it("ランプ：動いている行は緑、順番待ちは紫の数字（番号順）、止まった実装中は赤、公開済みは無し", () => {
    const lampOf = (key: string) => messages.find((m) => m.key === key)?.lamp;
    expect(lampOf("demo/todo-app#16")).toEqual({ kind: "running" });
    expect(lampOf("demo/todo-app#14")).toEqual({ kind: "waiting", position: 1 });
    expect(lampOf("demo/todo-app#15")).toEqual({ kind: "waiting", position: 2 });
    expect(lampOf("demo/landing-page#16")).toEqual({ kind: "needsHuman" });
    for (const m of messages.filter((m) => m.deployed)) expect(m.lamp).toEqual({ kind: "none" });
  });

  it("理由の印つきの保留（Paused）は「いまの様子」に出さない（Slots & Queue の Paused だけ。Issue #520）", () => {
    const keys = new Set(messages.map((m) => m.key));
    expect(keys.has("demo/todo-app#42")).toBe(false);
    expect(keys.has("demo/todo-app#43")).toBe(false);
  });

  it("リポジトリを絞ると、そのリポジトリの物だけ", () => {
    const only = buildConversation(results, events, NOW, { owner: "demo", repo: "todo-app" });
    expect(only.length).toBeGreaterThan(0);
    for (const m of only) expect(m.repo).toBe("todo-app");
  });
});
