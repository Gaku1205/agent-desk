import { describe, expect, it } from "vitest";
import type { CommentData, IssueData, IssueEventData, RepoData, RepoResult } from "../github/types";
import type { ParallelSettings } from "../parallel";
import { buildUsageChart, buildUsageSource, usageSummary, usageSummaryDetail, USAGE_BUCKET_MS } from "./usage";

// 日本時間 11:13
const NOW = new Date("2026-11-18T02:13:00Z");
const SETTINGS: ParallelSettings = { day: 3, night: 1, nightHours: { start: 23, end: 7 } };

function issue(number: number, labels: string[] = []): IssueData {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    labels,
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: "2026-11-17T00:00:00Z",
    updatedAt: "2026-11-17T00:00:00Z",
    closedAt: null,
  };
}

function log(issueNumber: number, rows: { step: string; started: string; finished: string | null }[]): CommentData {
  const lines = rows.map(
    (row) => `<!-- ai-step ${JSON.stringify({ ...row, model: "opus", result: "ok" })} -->`,
  );
  return {
    id: issueNumber * 100 + rows.length,
    issueNumber,
    author: "github-actions[bot]",
    body: `<!-- ai-step-log -->\n${lines.join("\n")}`,
    createdAt: "2026-11-17T00:00:00Z",
  };
}

function label(event: "labeled" | "unlabeled", labelName: string, issueNumber: number, createdAt: string): IssueEventData {
  return { event, labelName, issueNumber, createdAt };
}

function result(over: Partial<RepoData>): RepoResult {
  return {
    owner: "o",
    repo: "r",
    ok: true,
    data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...over },
  };
}

/** 材料の段の番号（始まりは 2026-11-17T02:15Z） */
const bucketAt = (iso: string, source: { startMs: number }) =>
  Math.floor((Date.parse(iso) - source.startMs) / USAGE_BUCKET_MS);

describe("buildUsageSource", () => {
  it("読めたリポジトリが無ければ null", () => {
    const failed: RepoResult = { owner: "o", repo: "x", ok: false, error: { kind: "other", message: "x" } };
    expect(buildUsageSource([failed], NOW)).toBeNull();
  });

  it("進捗ログも順番待ちの記録も無ければ null（作り物を出さない）", () => {
    expect(buildUsageSource([result({ issues: [issue(1)] })], NOW)).toBeNull();
  });

  it("24時間を15分ごとの96段にする", () => {
    const source = buildUsageSource([result({ comments: [log(1, [{ step: "implement", started: "2026-11-18T01:00:00Z", finished: "2026-11-18T01:30:00Z" }])] })], NOW);
    expect(source?.queued).toHaveLength(96);
    expect(source?.used).toHaveLength(96);
    expect(source?.startMs).toBe(Date.parse("2026-11-17T02:15:00Z"));
  });

  it("枠を使う工程だけ数え、同時に動いた数を段ごとに出す", () => {
    const source = buildUsageSource(
      [
        result({
          comments: [
            log(1, [
              { step: "implement", started: "2026-11-18T01:00:00Z", finished: "2026-11-18T01:30:00Z" },
              { step: "ci", started: "2026-11-18T01:20:00Z", finished: "2026-11-18T01:40:00Z" },
            ]),
            log(2, [{ step: "implement", started: "2026-11-18T01:15:00Z", finished: "2026-11-18T01:50:00Z" }]),
            log(3, [{ step: "plan", started: "2026-11-18T01:00:00Z", finished: "2026-11-18T01:50:00Z" }]),
          ],
        }),
      ],
      NOW,
    );
    const at = (iso: string) => source!.used![bucketAt(iso, source!)];
    expect(at("2026-11-18T01:00:00Z")).toBe(1); // 1だけ
    expect(at("2026-11-18T01:15:00Z")).toBe(2); // 1と2（1の implement と ci が重なっても1件）
    expect(at("2026-11-18T01:45:00Z")).toBe(1); // 2だけ（plan は数えない）
    expect(at("2026-11-18T02:00:00Z")).toBe(0);
    expect(at("2026-11-18T00:45:00Z")).toBe(0);
  });

  it("終わっていない行は今まで", () => {
    const source = buildUsageSource(
      [result({ comments: [log(1, [{ step: "implement", started: "2026-11-18T02:00:00Z", finished: null }])] })],
      NOW,
    );
    expect(source!.used![bucketAt("2026-11-18T02:00:00Z", source!)]).toBe(1);
    expect(source!.used![bucketAt("2026-11-18T01:45:00Z", source!)]).toBe(0);
  });

  it("順番待ちは、ラベルが付いてから外れるまで。ai:queue と ai:blocked の両方で1件", () => {
    const source = buildUsageSource(
      [
        result({
          events: [
            label("labeled", "ai:queue", 5, "2026-11-18T00:00:00Z"),
            label("labeled", "ai:blocked", 5, "2026-11-18T00:30:00Z"),
            label("unlabeled", "ai:queue", 5, "2026-11-18T00:45:00Z"),
            label("unlabeled", "ai:blocked", 5, "2026-11-18T01:00:00Z"),
            label("labeled", "ai:queue", 6, "2026-11-18T00:30:00Z"),
            label("unlabeled", "ai:queue", 6, "2026-11-18T00:50:00Z"),
          ],
        }),
      ],
      NOW,
    );
    const at = (iso: string) => source!.queued[bucketAt(iso, source!)];
    expect(source!.used).toBeNull();
    expect(at("2026-11-18T00:15:00Z")).toBe(1);
    expect(at("2026-11-18T00:30:00Z")).toBe(2);
    expect(at("2026-11-18T00:45:00Z")).toBe(2); // 段の中でいちばん多い数（6 が 0:50 まで）
    expect(at("2026-11-18T01:00:00Z")).toBe(0);
  });

  it("外れた記録が無い物は、いま順番待ちなら今まで、そうでなければ数えない", () => {
    const source = buildUsageSource(
      [
        result({
          issues: [issue(5, ["ai:queue"]), issue(6, ["ai:implement"])],
          events: [
            label("labeled", "ai:queue", 5, "2026-11-18T01:00:00Z"),
            label("labeled", "ai:queue", 6, "2026-11-18T01:00:00Z"),
          ],
        }),
      ],
      NOW,
    );
    expect(source!.queued[bucketAt("2026-11-18T02:00:00Z", source!)]).toBe(1);
  });
});

describe("buildUsageChart", () => {
  const source = buildUsageSource(
    [
      result({
        issues: [issue(5, ["ai:queue"])],
        comments: [log(1, [{ step: "implement", started: "2026-11-18T01:00:00Z", finished: "2026-11-18T02:00:00Z" }])],
        events: [label("labeled", "ai:queue", 5, "2026-11-18T01:00:00Z")],
      }),
    ],
    NOW,
  )!;

  it("上限は昼と夜で変わり、夜の時間帯が帯になる（日本時間 23時〜7時）", () => {
    const chart = buildUsageChart(source, SETTINGS);
    const noon = chart.buckets[bucketAt("2026-11-18T01:00:00Z", source)]; // 日本時間 10:00
    const night = chart.buckets[bucketAt("2026-11-17T16:00:00Z", source)]; // 日本時間 1:00
    expect([noon.limit, noon.night]).toEqual([3, false]);
    expect([night.limit, night.night]).toEqual([1, true]);
    expect(chart.nightSpans.length).toBeGreaterThan(0);
    expect(chart.limits).toEqual({ day: 3, night: 1 });
  });

  it("順番待ちが最も多かった所を印にする。縦は5以上", () => {
    const chart = buildUsageChart(source, SETTINGS);
    expect(chart.peak?.value).toBe(1);
    expect(chart.yMax).toBe(5);
    expect(chart.yTicks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("5を超えたら、目盛りの間隔を広げて上端をそろえる", () => {
    const many = {
      startMs: source.startMs,
      used: source.queued.map((_, index) => (index === 3 ? 22 : 0)),
      queued: source.queued,
      queuedBy: source.queuedBy,
    };
    const chart = buildUsageChart(many, SETTINGS);
    expect(chart.yTicks).toEqual([0, 5, 10, 15, 20, 25]);
    expect(chart.yMax).toBe(25);
  });

  it("空きがあるのに入れなかった時間：使っていた数が上限より少なく、順番待ちがある段", () => {
    const chart = buildUsageChart(source, SETTINGS);
    // 1:00〜2:00（使っている1件＜上限3）の4段、2:00〜2:15 は順番待ち中で使用0
    expect(chart.blockedMs).toBeGreaterThanOrEqual(4 * USAGE_BUCKET_MS);
    expect(usageSummary(chart, (ms) => `${ms / 60_000}m`)).toMatch(/^空き席の待ち \d+m$/);
  });

  it("内訳は ai:queue（ファイルの重なり待ち）と ai:blocked（前の作業待ち）の付いていた時間で分ける", () => {
    const split = buildUsageSource(
      [
        result({
          comments: [log(1, [{ step: "implement", started: "2026-11-18T00:00:00Z", finished: "2026-11-18T00:15:00Z" }])],
          events: [
            label("labeled", "ai:queue", 5, "2026-11-18T01:00:00Z"),
            label("unlabeled", "ai:queue", 5, "2026-11-18T02:00:00Z"),
            label("labeled", "ai:blocked", 6, "2026-11-18T02:00:00Z"),
            label("unlabeled", "ai:blocked", 6, "2026-11-18T02:10:00Z"),
          ],
        }),
      ],
      NOW,
    )!;
    const chart = buildUsageChart(split, SETTINGS);
    expect(chart.blockedBy).toEqual({ queueMs: 4 * USAGE_BUCKET_MS, blockedMs: USAGE_BUCKET_MS });
    expect(chart.blockedMs).toBe(5 * USAGE_BUCKET_MS);
    expect(usageSummaryDetail(chart, (ms) => `${ms / 60_000}m`)).toBe(
      "席が空いているのに始まらなかった時間の内訳：ファイルの重なり待ち 60m · 前の作業待ち 15m",
    );
  });

  it("並列の設定が読めなければ、上限・夜の帯・空きの判定を出さない", () => {
    const chart = buildUsageChart(source, null);
    expect(chart.limits).toBeNull();
    expect(chart.nightSpans).toEqual([]);
    expect(chart.blockedMs).toBeNull();
    expect(chart.buckets.every((bucket) => bucket.limit === null)).toBe(true);
    expect(usageSummary(chart, String)).toBe("使っていた席は最大 1件、順番待ちは最大 1件");
  });

  it("進捗ログが無ければ、使っていた枠は出さず、空きの判定もしない", () => {
    const onlyQueue = buildUsageSource(
      [result({ events: [label("labeled", "ai:queue", 5, "2026-11-18T01:00:00Z"), label("unlabeled", "ai:queue", 5, "2026-11-18T01:30:00Z")] })],
      NOW,
    )!;
    const chart = buildUsageChart(onlyQueue, SETTINGS);
    expect(chart.maxUsed).toBeNull();
    expect(chart.blockedMs).toBeNull();
    expect(chart.buckets.every((bucket) => bucket.used === null)).toBe(true);
  });

  it("夜の時間帯が無い設定では、帯も夜の上限も出さない", () => {
    const chart = buildUsageChart(source, { day: 3, night: 1, nightHours: null });
    expect(chart.nightSpans).toEqual([]);
    expect(chart.limits).toEqual({ day: 3, night: null });
  });

  it("目盛りは日本時間の6時間ごと", () => {
    const chart = buildUsageChart(source, SETTINGS);
    expect(chart.ticks.map((tick) => tick.label)).toEqual(["12:00", "18:00", "0:00", "6:00"]);
  });

  it("空きがあるのに入れなかった時間が無ければ、その旨の1行", () => {
    const quiet = buildUsageSource(
      [result({ comments: [log(1, [{ step: "implement", started: "2026-11-18T01:00:00Z", finished: "2026-11-18T02:00:00Z" }])] })],
      NOW,
    )!;
    expect(usageSummary(buildUsageChart(quiet, SETTINGS), String)).toBe("空き席の待ち なし");
  });
});
