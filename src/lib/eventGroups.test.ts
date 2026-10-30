import { describe, expect, it } from "vitest";
import { buildDemoResults } from "./demo/data";
import { startPlayback } from "./demo/playback";
import { currentStep, groupTrailDays, groupTrails, isDeployedTrail, jstDay, splitDeployed } from "./eventGroups";
import { buildRecentEvents, buildTrailEvents, type TrailEvent } from "./events";
import type { Stage } from "./status";

const NOW = new Date("2026-10-25T08:00:00Z"); // 日本時間 10月25日 17:00

function ev(
  id: string,
  at: string,
  number: number,
  short: string,
  tone: TrailEvent["tone"] = "ai",
  stage: Stage = "reviewing",
): TrailEvent {
  return {
    id,
    at,
    tone,
    icon: "check",
    text: short,
    short,
    ref: `r#${number}`,
    issue: { owner: "o", repo: "r", number, title: `Issue ${number}`, url: "https://example.com", stage },
  };
}

describe("公開済みと今の足あと", () => {
  const trails = groupTrails([
    ev("a", "2026-10-25T01:00:00Z", 1, "PRができた", "ai", "deployed"),
    ev("b", "2026-10-25T02:00:00Z", 1, "本番に公開", "deployed", "deployed"),
    ev("c", "2026-10-25T03:00:00Z", 2, "公開に失敗", "fail", "deployFailed"),
    ev("d", "2026-10-25T04:00:00Z", 3, "マージ", "operation", "deploying"),
    ev("e", "2026-10-25T05:00:00Z", 4, "レビュー依頼", "operation", "reviewing"),
  ]);

  it("公開済み（deployed）だけを分ける。公開失敗・公開中は隠さない", () => {
    const { active, deployed } = splitDeployed(trails);
    expect(deployed.map((t) => t.issue.number)).toEqual([1]);
    expect(active.map((t) => t.issue.number)).toEqual([4, 3, 2]);
    expect(isDeployedTrail(trails.find((t) => t.issue.number === 2)!)).toBe(false);
  });

  it("今の足あとは、いちばん新しい1つ", () => {
    const one = trails.find((t) => t.issue.number === 1)!;
    expect(currentStep(one).short).toBe("本番に公開");
  });
});

describe("groupTrails", () => {
  it("同じ Issue の出来事を1つの列にまとめ、古い順に並べる", () => {
    const trails = groupTrails([
      ev("b", "2026-10-25T02:00:00Z", 3, "CI 4/4"),
      ev("a", "2026-10-25T01:00:00Z", 3, "PRができた"),
      ev("c", "2026-10-25T01:30:00Z", 4, "実装を依頼", "operation"),
    ]);
    expect(trails.map((t) => t.key)).toEqual(["o/r#3", "o/r#4"]);
    expect(trails[0].steps.map((s) => s.short)).toEqual(["PRができた", "CI 4/4"]);
    expect(trails[0].steps[0].time).toBe("10:00");
    expect(trails[0].latestAt).toBe("2026-10-25T02:00:00Z");
  });

  it("新しい出来事がある Issue が上", () => {
    const trails = groupTrails([
      ev("a", "2026-10-25T01:00:00Z", 1, "x"),
      ev("b", "2026-10-25T03:00:00Z", 2, "y"),
    ]);
    expect(trails.map((t) => t.issue.number)).toEqual([2, 1]);
  });
});

describe("groupTrailDays", () => {
  it("日本時間の日ごとに分け、新しい日が先。見出しは今日・昨日・日付", () => {
    const days = groupTrailDays(
      [
        ev("a", "2026-10-25T01:00:00Z", 1, "x"),
        ev("b", "2026-10-24T01:00:00Z", 1, "y"),
        ev("c", "2026-10-23T01:00:00Z", 2, "z"),
      ],
      NOW,
    );
    expect(days.map((d) => d.heading)).toEqual(["今日", "昨日", "10月23日"]);
    expect(days.map((d) => d.day)).toEqual(["2026-10-25", "2026-10-24", "2026-10-23"]);
    expect(days[0].count).toBe(1);
  });

  it("日本時間で日付が変わる（UTC 15:00 以降は翌日）", () => {
    expect(jstDay("2026-10-24T15:00:00Z")).toBe("2026-10-25");
    expect(jstDay("2026-10-24T14:59:59Z")).toBe("2026-10-24");
  });

  it("出来事が無ければ空", () => {
    expect(groupTrailDays([], NOW)).toEqual([]);
  });
});

describe("buildTrailEvents", () => {
  const results = buildDemoResults(NOW, startPlayback(NOW));

  it("buildRecentEvents と同じ出来事を、Issue と短い文言つきで返す", () => {
    const trails = buildTrailEvents(results, NOW);
    const plain = buildRecentEvents(results, NOW);
    expect(trails.map((e) => e.id)).toEqual(plain.map((e) => e.id));
    for (const event of trails) {
      expect(event.short).not.toBe("");
      expect(event.issue.number).toBeGreaterThan(0);
      expect(event.ref.startsWith(event.issue.repo)).toBe(true);
    }
  });

  it("Issue に今の段階がつく（公開済みの Issue は deployed）", () => {
    const trails = buildTrailEvents(results, NOW);
    expect(trails.every((e) => typeof e.issue.stage === "string")).toBe(true);
    expect(trails.some((e) => e.short === "本番に公開" && e.issue.stage === "deployed")).toBe(true);
  });

  it("リポジトリで絞れる", () => {
    const trails = buildTrailEvents(results, NOW, { owner: "demo", repo: "landing-page" });
    expect(trails.length).toBeGreaterThan(0);
    expect(trails.every((e) => e.issue.repo === "landing-page")).toBe(true);
  });

  it("短い文言：PRができた・CI 4/4・レビュー済・マージ・本番に公開", () => {
    const shorts = new Set(buildTrailEvents(results, NOW).map((e) => e.short));
    for (const s of ["PRができた", "CI 4/4", "レビュー済", "自動でマージ", "本番に公開", "実装を依頼"]) {
      expect(shorts.has(s), s).toBe(true);
    }
  });
});
