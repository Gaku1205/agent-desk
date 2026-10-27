import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRecentEvents } from "../events";
import { countPipelineWork, buildPipelineRows } from "../pipeline";
import { getIssueStatus, shouldShowIssue, type IssueStatus, type Stage } from "../status";
import { buildTurnItems } from "../turn";
import { buildDemoResults, DEMO_REPOS } from "./data";
import { getDemoNow } from "./now";
import { advancePlayback, isPlaybackDone, startPlayback } from "./playback";

const NOW = new Date("2026-10-26T03:00:00Z");

/** 全部の段階（型で、抜けがあればエラーになる） */
const ALL_STAGES: Record<Stage, true> = {
  stuck: true,
  retrying: true,
  deployed: true,
  deploying: true,
  deployFailed: true,
  fixing: true,
  reviewing: true,
  mergeWaiting: true,
  ciRunning: true,
  ciFailed: true,
  prWaiting: true,
  implementing: true,
  planning: true,
  queued: true,
  skipped: true,
  notStarted: true,
};

function statuses(now: Date = NOW): IssueStatus[] {
  return buildDemoResults(now, startPlayback(now)).flatMap((result) =>
    result.ok
      ? result.data.issues
          .filter((issue) => shouldShowIssue(issue, result.data.pulls))
          .map((issue) => getIssueStatus(issue, result.data, now))
      : [],
  );
}

describe("デモのサンプル", () => {
  it("架空のリポジトリ2つで、どちらも取れている", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    expect(results.map((r) => `${r.owner}/${r.repo}`)).toEqual(["demo/todo-app", "demo/landing-page"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(DEMO_REPOS).toHaveLength(2);
  });

  it("全部の段階が含まれる", () => {
    const stages = new Set(statuses().map((status) => status.stage));
    for (const stage of Object.keys(ALL_STAGES) as Stage[]) {
      expect(stages, stage).toContain(stage);
    }
  });

  it("修正の確認中・マージ待ちの3通り・エラーで終了・公開状況は不明も含まれる", () => {
    const all = statuses();
    expect(all.some((s) => s.verifyingFix)).toBe(true);
    expect(new Set(all.map((s) => s.mergeWait))).toEqual(
      new Set([null, "hold", "needsReview", "autoMerge"]),
    );
    expect(all.some((s) => s.stage === "prWaiting" && s.implementError)).toBe(true);
    expect(all.some((s) => s.stage === "deployed" && s.deployUnknown)).toBe(true);
    expect(all.some((s) => s.stage === "stuck" && s.stuckReason !== null)).toBe(true);
  });

  it("マージ後の公開は失敗したが、あとの公開が成功した物は公開済みに出る（失敗のままの物は失敗）", () => {
    const all = statuses();
    const later = all.find((s) => s.pull?.title === "ボタンを押したときの色を変える");
    expect(later?.stage).toBe("deployed");
    expect(all.find((s) => s.stage === "deployFailed")).toBeDefined();
  });

  it("あなたの番・順番待ちの理由・並列動作・最近の出来事がある", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    expect(buildTurnItems(results, NOW).length).toBeGreaterThan(0);

    const todo = results[0];
    if (!todo.ok) throw new Error("取れていない");
    const rows = buildPipelineRows(todo.data, NOW);
    expect(rows.filter((row) => row.queueReason !== null).length).toBeGreaterThanOrEqual(2);
    expect(countPipelineWork(rows).working).toBeGreaterThanOrEqual(1);
    // 公開済みは5件より多い（「さらに5件表示」が出る）
    expect(rows.filter((row) => row.status.stage === "deployed").length).toBeGreaterThan(5);

    const events = buildRecentEvents(results, NOW);
    expect(events.length).toBeGreaterThan(10);
    expect(new Set(events.map((event) => event.tone))).toEqual(
      new Set(["human", "ai", "deployed", "fail", "operation"]),
    );
  });

  it("時刻は「今」からの相対（「今」をずらすと同じだけずれる）", () => {
    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const a = buildDemoResults(NOW, startPlayback(NOW));
    const b = buildDemoResults(later, startPlayback(later));
    const created = (results: typeof a) =>
      results.flatMap((r) => (r.ok ? r.data.issues.map((i) => Date.parse(i.createdAt)) : []));
    expect(created(b).map((time, i) => time - created(a)[i])).toEqual(
      created(a).map(() => 24 * 60 * 60 * 1000),
    );
    // 「今」が違っても、段階は同じ
    expect(statuses(later).map((s) => s.stage)).toEqual(statuses().map((s) => s.stage));
  });
});

describe("デモの間、GitHubに問い合わせない", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("サンプルを作って画面の中身にするまで、fetch を1回も呼ばない", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let playback = startPlayback(getDemoNow({}));
    for (;;) {
      const now = new Date(playback.now);
      const results = buildDemoResults(NOW, playback);
      buildTurnItems(results, now);
      buildRecentEvents(results, now);
      for (const result of results) if (result.ok) buildPipelineRows(result.data, now);
      if (isPlaybackDone(playback)) break;
      playback = advancePlayback(playback);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /** デモのページ・部品・データが読み込むファイル */
  function demoSources(): string[] {
    const root = join(process.cwd(), "src");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const components = readdirSync(join(root, "components"))
      .filter((name) => name.startsWith("Demo"))
      .map((name) => join(root, "components", name));
    return [...walk(join(root, "app", "demo")), ...walk(join(root, "lib", "demo")), ...components].filter(
      (path) => !path.endsWith(".test.ts"),
    );
  }

  it("デモのページ・部品・データは、GitHubの取得・トークン・Server Action を読み込まない", () => {
    const forbidden = [
      /from "@\/lib\/auth"/,
      /from "[^"]*github\/(client|fetch|settings|operations)"/,
      /from "@\/lib\/(loadTurns|watchedRepos)"/,
      /from "@\/app\/[^"]*actions"/,
      /\bfetch\(/,
    ];
    const sources = demoSources();
    expect(sources.length).toBeGreaterThan(5);
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      for (const pattern of forbidden) expect(text, `${path} ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe("getDemoNow", () => {
  it("DEMO_NOW があれば、その時刻に固定する", () => {
    expect(getDemoNow({ DEMO_NOW: "2026-10-26T01:23:45Z" }).toISOString()).toBe(
      "2026-10-26T01:23:45.000Z",
    );
  });

  it("無い・読めなければ、本当の今", () => {
    const fallback = new Date("2026-01-01T00:00:00Z");
    expect(getDemoNow({}, fallback)).toBe(fallback);
    expect(getDemoNow({ DEMO_NOW: "" }, fallback)).toBe(fallback);
    expect(getDemoNow({ DEMO_NOW: "あした" }, fallback)).toBe(fallback);
  });
});
