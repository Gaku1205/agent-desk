import { describe, expect, it } from "vitest";
import {
  buildConversation,
  chatCi,
  chatLine,
  compareMessages,
  messageFlow,
  queueAfterNumber,
  type ChatMessage,
} from "./conversation";
import { getFlowExtras } from "./flowExtraBranches";
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
        text: "main とぶつかっています。AIが解消します。待つだけです",
      });
    }
  });

  it("修正の依頼が出ているときは、AIが解消しますを付ける", () => {
    expect(chatLine(status({ stage: "fixing", pull: conflictPull }))).toEqual({
      speaker: "AI",
      text: "main とぶつかっています。AIが解消中です。待つだけです",
    });
  });

  it("コンフリクトでなければ今までどおり", () => {
    expect(
      chatLine(status({ stage: "mergeWaiting", mergeWait: "autoMerge", pull: { conflicting: false } as NonNullable<IssueStatus["pull"]> })).text,
    ).toBe("CI・レビューOK・まもなく自動マージ");
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
    expect(chatLine(status({ stage: "planning" }))).toEqual({ speaker: "企画AI", text: "企画AIが清書中" });
    expect(chatLine(status({ stage: "implementing" }))).toEqual({ speaker: "AI", text: "AIが実装しています" });
    expect(chatLine(status({ stage: "ciRunning" }))).toEqual({ speaker: "CI", text: "4/7 CI ✓3 ◌1 実行中" });
    expect(chatLine(status({ stage: "reviewing" }))).toEqual({ speaker: "レビューAI", text: "レビューAIが確認中" });
    expect(chatLine(status({ stage: "fixing", fixCount: 2 }))).toEqual({ speaker: "AI", text: "AIが直しています（2/3 回目）" });
    expect(chatLine(status({ stage: "fixing", fixCount: 3 }))).toEqual({ speaker: "AI", text: "AIが直しています（3/3 回目）" });
    expect(chatLine(status({ stage: "fixing", fixCount: 5 }))).toEqual({ speaker: "AI", text: "AIが直しています（3/3 回目）" });
    expect(chatLine(status({ stage: "fixing", fixCount: 1, fixLimit: 4 }))).toEqual({ speaker: "AI", text: "AIが直しています（1/4 回目）" });
    expect(chatLine(status({ stage: "ciFailed", fixCount: 1 }))).toEqual({ speaker: "AI", text: "AIが直しています（2/3 回目）" });
    expect(chatLine(status({ stage: "ciFailed", fixCount: 3 }))).toEqual({
      speaker: "CI",
      text: "CI失敗・修正の上限",
    });
    expect(chatLine(status({ stage: "deploying", turn: "none" }))).toEqual({ speaker: "本番", text: "本番に公開中" });
  });

  it("修正の確認中は、CIとレビューで確かめている文", () => {
    const text = "修正をCIとレビューで確認中（CI 3/4）";
    expect(chatLine(status({ stage: "ciRunning", verifyingFix: true })).text).toBe(text);
    expect(chatLine(status({ stage: "reviewing", verifyingFix: true })).text).toBe(text);
  });

  it("マージ待ち（AI）は、自動マージかレビューに回すか", () => {
    expect(chatLine(status({ stage: "mergeWaiting", mergeWait: "autoMerge", ci: { passed: 4, total: 4 } })).text).toBe(
      "CI・レビューOK・まもなく自動マージ",
    );
    expect(chatLine(status({ stage: "mergeWaiting", mergeWait: "needsReview", ci: { passed: 4, total: 4 } })).text).toBe(
      "CI通過（4/4）・レビューへ",
    );
  });

  it("順番待ちは、理由に番号があれば「#17 の後」を添える", () => {
    expect(chatLine(status({ stage: "queued", turn: "none" }), { queueAfter: 17 }).text).toBe(
      "順番待ち（#17 の後）",
    );
    expect(chatLine(status({ stage: "queued", turn: "none" })).text).toBe("順番待ち");
  });

  it("公開済みは、不明なら分からないと言う", () => {
    expect(chatLine(status({ stage: "deployed", turn: "none" })).text).toBe("本番に公開しました");
    expect(chatLine(status({ stage: "deployed", turn: "none", deployUnknown: true })).text).toBe(
      "マージ済み・公開状況は不明",
    );
  });

  it("猶予の間はパイプラインの番", () => {
    expect(chatLine(status({ stage: "notStarted", grace: "intake" }))).toEqual({
      speaker: "パイプライン",
      text: "受付が企画に回すか判断中",
    });
    expect(chatLine(status({ stage: "prWaiting", grace: "creatingPull" })).text).toBe(
      "AIの作業完了・PRを作成中",
    );
  });

  it("やり直し待ちは、理由と回数の説明文", () => {
    const line = chatLine(status({ stage: "retrying", turn: "none", retry: { count: 2, max: 10, reason: "利用上限" } }));
    expect(line.speaker).toBe("パイプライン");
    expect(line.text).toBe("利用上限（2/10回）。AIが自動でやり直します。待つだけです");
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

  it("CI失敗・修正の上限で止まった行は、修正の実行が動いていても赤・失敗の色・回る印なし（Issue #693）", () => {
    const stopped = messages.find((m) => m.key === "demo/todo-app#18");
    expect(stopped?.text).toBe("CI失敗・修正の上限");
    expect(stopped?.lamp).toEqual({ kind: "needsHuman" });
    expect(stopped?.failed).toBe(true);
    expect(stopped?.activity).toBeNull();
  });

  it("理由の印つきの保留（Paused）は「いまの様子」に出さない（Slots & Queue の Paused だけ。Issue #520）", () => {
    const keys = new Set(messages.map((m) => m.key));
    expect(keys.has("demo/todo-app#42")).toBe(false);
    expect(keys.has("demo/todo-app#43")).toBe(false);
  });

  it("画面に渡す形は細い：PR の本文・ファイルの一覧・SHA は渡さず、審査役の点数と進捗図の工程は変わらない（Issue #700）", () => {
    const body = "PRの長い本文 SECRET-BODY\n\n## 審査役\n点数: 7.5\n\n詳しい説明 SECRET-TAIL";
    const fat = results.map((result) =>
      result.ok
        ? {
            ...result,
            data: {
              ...result.data,
              pulls: result.data.pulls.map((pull) => ({
                ...pull,
                body,
                files: ["src/SECRET-FILE.ts"],
                headSha: "SECRET-SHA-0123456789",
              })),
            },
          }
        : result,
    );
    const slim = buildConversation(fat, buildTrailEvents(fat, NOW), NOW);
    const json = JSON.stringify(slim);
    for (const secret of ["SECRET-BODY", "SECRET-TAIL", "SECRET-FILE", "SECRET-SHA"]) expect(json).not.toContain(secret);
    expect(slim.some((m) => m.flowExtra?.status.pull?.body.includes("点数: 7.5"))).toBe(true);
    // 審査役の点数（7.5＝8未満）から、実装に戻る枝が今までどおり決まる
    const critiqued = slim.find((m) => m.flowExtra?.status.pull);
    expect(critiqued?.flowExtra && getFlowExtras({ ...critiqued.flowExtra, stepLog: null }).branches.map((b) => b.kind)).toContain(
      "critique",
    );
    // 公開済みの行は工程を渡さず、細い状態から「公開」が成功の工程が決まる
    const deployed = slim.filter((m) => m.deployed);
    expect(deployed.length).toBeGreaterThan(0);
    for (const m of deployed) {
      expect(m.flow).toBeUndefined();
      const flow = messageFlow(m);
      expect(flow.steps).toHaveLength(7);
      expect(flow.steps[flow.at]).toMatchObject({ key: "deploy", state: "done" });
    }
  });

  it("リポジトリを絞ると、そのリポジトリの物だけ", () => {
    const only = buildConversation(results, events, NOW, { owner: "demo", repo: "todo-app" });
    expect(only.length).toBeGreaterThan(0);
    for (const m of only) expect(m.repo).toBe("todo-app");
  });
});

describe("工場の Issue の「いまの様子」（Issue #659）", () => {
  const results = buildDemoResults(NOW, startPlayback(NOW));
  const messages = buildConversation(results, buildTrailEvents(results, NOW), NOW);

  it("工場が作業中のデモの Issue は、相談待ちと出ず、段の文と経過時間が出る", () => {
    const message = messages.find((m) => m.key === "demo/landing-page#24");
    expect(message?.speaker).toBe("工場");
    expect(message?.text).toBe("作っています（12分）。待つだけです");
    expect(message?.text).not.toContain("相談待ち");
  });

  it("chatLine：工場の段が相談待ちのときだけ相談待ち、段が無いとき（ラベルも実行も無い）は中立な文", () => {
    const notStarted = status({ stage: "notStarted" });
    const text = (kind: "waiting" | "unknown") =>
      chatLine(notStarted, { factory: { kind, text: null, startedAt: null }, now: NOW }).text;
    expect(text("waiting")).toBe("工場が相談の答えを待っています。Your turn で選んでください");
    expect(text("unknown")).toBe("工場が受け付けています。待つだけです");
  });
});
