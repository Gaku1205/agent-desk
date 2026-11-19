import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRecentEvents } from "../events";
import { countPipelineWork, buildPipelineRows } from "../pipeline";
import { applyStepLog, getFlow, hideUnknownModels, UNKNOWN_MODEL } from "../flow";
import { demoStepLog } from "./stepLog";
import { getIssueStatus, shouldShowIssue, type IssueStatus, type Stage } from "../status";
import { countRunningPipelineRows } from "../runningPipeline";
import { buildTurnItems, countTurnItems } from "../turn";
import { assignSlots } from "../lanes/slots";
import { queueGroups } from "../lanes/queueGroups";
import { isLongSleep, jobGauge } from "../lanes/sleeping";
import { buildLanesSource } from "../lanes/source";
import { buildUsageChart, buildUsageSource, USAGE_BUCKET_MS, usageSummary } from "../lanes/usage";
import {
  buildDemoResults,
  DEMO_AUTO_ADD_REPO,
  DEMO_PARALLEL_SETTINGS,
  DEMO_REPOS,
  demoAutoAdd,
  demoAutoAddResult,
} from "./data";
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
  question: true,
  factoryTalk: true,
  implementing: true,
  planning: true,
  queued: true,
  skipped: true,
  notice: true,
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

/** 再生の全部の段階（最初から最後まで）の、各 Issue の段階 */
function playbackStatuses(): IssueStatus[] {
  const all: IssueStatus[] = [];
  let playback = startPlayback(NOW);
  for (;;) {
    const now = new Date(playback.now);
    for (const result of buildDemoResults(NOW, playback)) {
      if (!result.ok) continue;
      for (const issue of result.data.issues) {
        if (shouldShowIssue(issue, result.data.pulls)) all.push(getIssueStatus(issue, result.data, now));
      }
    }
    if (isPlaybackDone(playback)) break;
    playback = advancePlayback(playback);
  }
  return all;
}

describe("デモのサンプル", () => {
  it("架空のリポジトリ3つで、どれも取れている（notes-api は 0・0 の見本）", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    expect(results.map((r) => `${r.owner}/${r.repo}`)).toEqual([
      "demo/todo-app",
      "demo/landing-page",
      "demo/notes-api",
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(DEMO_REPOS).toHaveLength(3);
    const turn = countTurnItems(buildTurnItems(results, NOW));
    const running = countRunningPipelineRows(results, NOW);
    expect(turn.byRepo["demo/notes-api"] ?? 0).toBe(0);
    expect(running.byRepo["demo/notes-api"] ?? 0).toBe(0);
  });

  it("全部の段階が含まれる（枠を使う段階は3件までなので、再生で進む1件の途中の段階を含めて）", () => {
    const stages = new Set([...statuses(), ...playbackStatuses()].map((status) => status.stage));
    for (const stage of Object.keys(ALL_STAGES) as Stage[]) {
      expect(stages, stage).toContain(stage);
    }
  });

  it("再生で進む1件の CI の段では、枠待ち（queued）のチェックが数えられる", () => {
    const ci = playbackStatuses().filter((status) => status.stage === "ciRunning" && !status.verifyingFix);
    expect(ci.length).toBeGreaterThan(0);
    expect(ci.some((status) => (status.ci.queued ?? 0) > 0)).toBe(true);
  });

  it("枠を使う段階の Issue は、全部のリポジトリを合わせて昼の上限以内。Slots が埋まり、Queue が3件以上ある", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    const lanes = assignSlots(buildLanesSource(results, NOW), DEMO_PARALLEL_SETTINGS.day);
    expect(lanes.counts.running).toBeLessThanOrEqual(DEMO_PARALLEL_SETTINGS.day);
    expect(lanes.counts.running).toBe(DEMO_PARALLEL_SETTINGS.day);
    expect(lanes.counts.free).toBe(0);
    expect(lanes.slots).toHaveLength(DEMO_PARALLEL_SETTINGS.day);
    expect(lanes.counts.queue).toBeGreaterThanOrEqual(3);
  });

  it("Queue のまとまり：動いている相手・複数の相手・順番待ちの順番待ち・灰色の親・誰も待たない物が見える", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    const source = buildLanesSource(results, NOW);
    const lanes = assignSlots(source, DEMO_PARALLEL_SETTINGS.day);
    const groups = queueGroups(lanes.queue, source.works);
    const kinds = groups.map((group) => group.kind);
    expect(kinds).toContain("work");
    expect(kinds).toContain("multi");
    expect(kinds).toContain("idle");
    expect(kinds[kinds.length - 1]).toBe("next");
    expect(groups.some((group) => group.rows.some((row) => row.depth === 2))).toBe(true);
  });

  it("Background：目覚ましが10件（うち2件は Long）、どれも席にぶら下がらず、動いている実行にジョブの数がある", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    const source = buildLanesSource(results, NOW);
    const lanes = assignSlots(source, DEMO_PARALLEL_SETTINGS.day);
    const sleeping = lanes.other.filter((run) => run.sleeping);
    expect(sleeping).toHaveLength(10);
    expect(sleeping.every((run) => run.wakeAtMs !== null)).toBe(true);
    expect(sleeping.filter((run) => isLongSleep(run.wakeAtMs, NOW))).toHaveLength(2);
    expect(lanes.other.some((run) => !run.sleeping)).toBe(true);
    const gauge = jobGauge(source.runs);
    expect(gauge.sleeping).toBe(10);
    expect(gauge.active).toBeGreaterThan(0);
  });

  it("Last 24h：どの時刻に開いても、使っていた枠はその時間帯の上限以内で、縦は0〜5に収まり、まとめがグラフと合う", () => {
    for (const hours of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const now = new Date(NOW.getTime() + hours * 60 * 60 * 1000);
      const results = buildDemoResults(now, startPlayback(now));
      const source = buildUsageSource(results, now);
      expect(source, `+${hours}h`).not.toBeNull();
      if (!source) continue;
      const chart = buildUsageChart(source, DEMO_PARALLEL_SETTINGS);
      expect(chart.yMax, `+${hours}h`).toBe(5);
      // いま動いている3件が重なる最後の段は、夜に開くと夜の上限を超える（動いている数だけ出す決まり）ので数えない
      const settled = chart.buckets.slice(0, -3);
      for (const bucket of settled) expect(bucket.used ?? 0, `+${hours}h ${bucket.startMs}`).toBeLessThanOrEqual(bucket.limit ?? 0);
      expect(chart.buckets.filter((bucket) => (bucket.used ?? 0) >= 1).length, `+${hours}h`).toBeGreaterThan(
        chart.buckets.length / 2,
      );
      expect(chart.buckets.some((bucket) => bucket.queued >= 3)).toBe(true);
      const blocked = chart.buckets.filter((bucket) => bucket.queued > 0 && (bucket.used ?? 0) < (bucket.limit ?? 0));
      expect(chart.blockedMs).toBe(blocked.length * USAGE_BUCKET_MS);
      expect(usageSummary(chart, (ms) => `${ms}`)).toContain("席が空いているのに始まらなかった時間は");
    }
  });

  it("修正の確認中・マージ待ちの3通り・エラーで終了・公開状況は不明も含まれる", () => {
    const all = statuses();
    expect([...all, ...playbackStatuses()].some((s) => s.verifyingFix)).toBe(true);
    expect(new Set(all.map((s) => s.mergeWait))).toEqual(
      new Set([null, "hold", "needsReview", "autoMerge"]),
    );
    expect(all.some((s) => s.stage === "prWaiting" && s.implementError)).toBe(true);
    expect(all.some((s) => s.stage === "deployed" && s.deployUnknown)).toBe(true);
    expect(all.some((s) => s.stage === "stuck" && s.stuckReason !== null)).toBe(true);
  });

  it("PR作成待ちは、猶予中（AIの番）と猶予を過ぎた物・エラーの物（人間の番）の両方がある", () => {
    const waiting = statuses().filter((s) => s.stage === "prWaiting");
    expect(waiting.some((s) => s.turn === "ai" && s.grace === "creatingPull")).toBe(true);
    expect(waiting.some((s) => s.turn === "human" && !s.implementError)).toBe(true);
    expect(waiting.some((s) => s.turn === "human" && s.implementError)).toBe(true);
    const items = buildTurnItems(buildDemoResults(NOW, startPlayback(NOW)), NOW);
    expect(items.some((item) => item.status.grace !== null)).toBe(false);
  });

  it("マージ後の公開は失敗したが、あとの公開が成功した物は公開済みに出る（失敗のままの物は失敗）", () => {
    const all = statuses();
    const later = all.find((s) => s.pull?.title === "ボタンを押したときの色を変える");
    expect(later?.stage).toBe("deployed");
    expect(all.find((s) => s.stage === "deployFailed")).toBeDefined();
  });

  it("上端の帯の件数：各リポジトリで、あなたの番と動いている件数が同じにならない", () => {
    const results = buildDemoResults(NOW, startPlayback(NOW));
    const turn = countTurnItems(buildTurnItems(results, NOW));
    const running = countRunningPipelineRows(results, NOW);
    // notes-api は 0・0 の見本（左のバーに出ない物）なので、数のある2つだけを見る
    for (const { owner, repo } of DEMO_REPOS.filter((r) => r.repo !== "notes-api")) {
      const key = `${owner}/${repo}`.toLowerCase();
      expect(turn.byRepo[key]).toBeGreaterThan(0);
      expect(running.byRepo[key]).toBeGreaterThan(0);
      expect(turn.byRepo[key]).not.toBe(running.byRepo[key]);
    }
  });

  it("止まった例は「AIが3回直しても」で、進捗図の分母（3）と合う", () => {
    const stuck = statuses().find((s) => s.stage === "stuck" && s.fixCount > 0);
    expect(stuck?.stuckReason).toContain("AIが3回直しても");
    expect(stuck?.fixCount).toBe(3);
    expect(stuck?.fixLimit).toBe(3);
  });

  it("進捗図：進捗ログのある工程にはモデル名と所要時間が入り、「不明」は並ばない", () => {
    const now = NOW;
    const results = buildDemoResults(now, startPlayback(now));
    let recorded = 0;
    for (const result of results) {
      if (!result.ok) continue;
      for (const issue of result.data.issues) {
        const infos = demoStepLog(results, result.owner, result.repo, issue.number, now);
        const flow = hideUnknownModels(applyStepLog(getFlow(getIssueStatus(issue, result.data, now)), infos));
        expect(flow.steps.some((step) => step.model === UNKNOWN_MODEL), `#${issue.number}`).toBe(false);
        for (const info of infos) {
          const step = flow.steps.find((s) => s.key === info.key);
          expect(step?.duration, `#${issue.number} ${info.key}`).not.toBeNull();
          recorded += 1;
        }
      }
    }
    expect(recorded).toBeGreaterThan(20);
    // 実装を済ませた Issue には、実装のモデル名が出る
    const implemented = demoStepLog(results, "demo", "todo-app", 22, now);
    expect(implemented.find((info) => info.key === "implement")?.model).toBe("sonnet");
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

describe("デモの自動追加", () => {
  /** 工場の相談で「作る」を押して、「新サービス：」の Issue が閉じた形 */
  function closedFactory(): ReturnType<typeof buildDemoResults> {
    return buildDemoResults(NOW, startPlayback(NOW)).map((result) =>
      result.ok && result.repo === "landing-page"
        ? {
            ...result,
            data: {
              ...result.data,
              issues: result.data.issues.map((issue) =>
                issue.number === 19 ? { ...issue, state: "closed" as const, closedAt: NOW.toISOString() } : issue,
              ),
            },
          }
        : result,
    );
  }

  it("工場の Issue が開いている間は足さない", () => {
    expect(demoAutoAdd(buildDemoResults(NOW, startPlayback(NOW)), true)).toBeNull();
  });

  it("閉じたら、テンプレートから作られた morning-card を足す（オフなら足さない）", () => {
    expect(demoAutoAdd(closedFactory(), true)).toEqual({ repo: DEMO_AUTO_ADD_REPO, at: NOW.toISOString() });
    expect(demoAutoAdd(closedFactory(), false)).toBeNull();
  });

  it("足したリポジトリは取れていて、動いている作業がある", () => {
    const result = demoAutoAddResult(NOW.toISOString());
    expect(result.ok).toBe(true);
    const counts = countRunningPipelineRows([result], NOW);
    expect(Object.values(counts.byRepo).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0);
  });
});

describe("デモの番号", () => {
  /** リポジトリごとに、Issue と PR の番号（共通の番号）の重なりを集める */
  function duplicates(results: ReturnType<typeof buildDemoResults>): string[] {
    const found: string[] = [];
    for (const result of results) {
      if (!result.ok) continue;
      const seen = new Set<number>();
      const numbers = [...result.data.issues, ...result.data.pulls].map((item) => item.number);
      for (const number of numbers) {
        if (seen.has(number)) found.push(`${result.owner}/${result.repo}#${number}`);
        seen.add(number);
      }
    }
    return found;
  }

  it("リポジトリの中で、Issue と PR の番号が重ならない", () => {
    expect(duplicates(buildDemoResults(NOW, startPlayback(NOW)))).toEqual([]);
  });

  it("再生の途中の各段階でも重ならない", () => {
    let playback = startPlayback(NOW);
    for (;;) {
      expect(duplicates(buildDemoResults(NOW, playback))).toEqual([]);
      if (isPlaybackDone(playback)) break;
      playback = advancePlayback(playback);
    }
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
