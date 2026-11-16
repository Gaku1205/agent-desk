import { describe, expect, it } from "vitest";
import {
  ADDED_LOG_MAX_ENTRIES,
  ADDED_NOTICE_MS,
  addedNoticeText,
  AUTO_ADD_MIN_INTERVAL_MS,
  buildAddedNotices,
  decideAutoAddCheck,
  factorySignal,
  formatAddedLog,
  formatAutoAddEnabled,
  parseAddedLog,
  parseAutoAddEnabled,
  pickAutoAddRepos,
  updateRemovedRepos,
  watchedTemplates,
  type PickAutoAddInput,
} from "./autoAdd";
import type { IssueData, RepoData, RepoResult } from "./github/types";

const NOW = new Date("2026-11-16T03:00:00Z");
const TEMPLATE = { owner: "gaku", repo: "ai-dev-template" };
const DESK = { owner: "gaku", repo: "agent-desk" };

function base(overrides: Partial<PickAutoAddInput> = {}): PickAutoAddInput {
  return {
    enabled: true,
    login: "Gaku",
    watched: [DESK, TEMPLATE],
    templates: [TEMPLATE],
    removed: [],
    candidates: [
      { name: "gaku/morning-card", template: "gaku/ai-dev-template" },
      { name: "gaku/plain", template: null },
    ],
    ...overrides,
  };
}

function issue(number: number, title: string, updatedAt: string, state: "open" | "closed" = "open"): IssueData {
  return { number, title, body: "", state, labels: [], url: "", createdAt: updatedAt, updatedAt, closedAt: null };
}

function result(repo: { owner: string; repo: string }, data: Partial<RepoData>): RepoResult {
  return { ...repo, ok: true, data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...data } };
}

describe("pickAutoAddRepos（足す候補の選び方）", () => {
  it("監視リストのテンプレートから作られた、ログイン中のユーザーのリポジトリを足す", () => {
    expect(pickAutoAddRepos(base())).toEqual([{ owner: "gaku", repo: "morning-card" }]);
  });

  it("外した物は足さない（大文字小文字は区別しない）", () => {
    expect(pickAutoAddRepos(base({ removed: [{ owner: "Gaku", repo: "Morning-Card" }] }))).toEqual([]);
  });

  it("既に監視中の物は足さない", () => {
    expect(pickAutoAddRepos(base({ watched: [DESK, TEMPLATE, { owner: "gaku", repo: "morning-card" }] }))).toEqual([]);
  });

  it("監視リストにテンプレートが無ければ足さない", () => {
    expect(pickAutoAddRepos(base({ templates: [] }))).toEqual([]);
  });

  it("オフなら足さない", () => {
    expect(pickAutoAddRepos(base({ enabled: false }))).toEqual([]);
  });

  it("持ち主がログイン中のユーザーでない物・ログインしていないときは足さない", () => {
    expect(
      pickAutoAddRepos(base({ candidates: [{ name: "someone/morning-card", template: "gaku/ai-dev-template" }] })),
    ).toEqual([]);
    expect(pickAutoAddRepos(base({ login: null }))).toEqual([]);
  });

  it("監視していないテンプレートから作られた物・テンプレートから作っていない物は足さない", () => {
    expect(
      pickAutoAddRepos(base({ candidates: [{ name: "gaku/other", template: "gaku/another-template" }] })),
    ).toEqual([]);
    expect(pickAutoAddRepos(base({ candidates: [{ name: "gaku/plain", template: null }] }))).toEqual([]);
  });

  it("同じ物を2回足さず、形の合わない名前は捨てる", () => {
    expect(
      pickAutoAddRepos(
        base({
          candidates: [
            { name: "gaku/a", template: "GAKU/ai-dev-template" },
            { name: "gaku/A", template: "gaku/ai-dev-template" },
            { name: "broken", template: "gaku/ai-dev-template" },
          ],
        }),
      ),
    ).toEqual([{ owner: "gaku", repo: "a" }]);
  });
});

describe("decideAutoAddCheck（調べ直しの下限）", () => {
  const now = NOW.getTime();

  it("テンプレートが無ければ、きっかけがあっても調べず、待たせもしない", () => {
    expect(decideAutoAddCheck({ templateCount: 0, requested: true, lastCheckedAt: null, now })).toEqual({
      check: false,
      pending: false,
    });
  });

  it("きっかけが無ければ調べない（同期のたびには調べない）", () => {
    expect(decideAutoAddCheck({ templateCount: 1, requested: false, lastCheckedAt: null, now }).check).toBe(false);
  });

  it("初めて・下限の時間がたっていれば調べる（ちょうどでも調べる）", () => {
    expect(decideAutoAddCheck({ templateCount: 1, requested: true, lastCheckedAt: null, now }).check).toBe(true);
    expect(
      decideAutoAddCheck({ templateCount: 1, requested: true, lastCheckedAt: now - AUTO_ADD_MIN_INTERVAL_MS, now }),
    ).toEqual({ check: true, pending: false });
  });

  it("下限の時間の中なら調べず、待たせる", () => {
    expect(decideAutoAddCheck({ templateCount: 1, requested: true, lastCheckedAt: now - 1000, now })).toEqual({
      check: false,
      pending: true,
    });
  });
});

describe("テンプレートと「新サービス：」の Issue の変化", () => {
  it("watchedTemplates は is_template が true と取れた物だけ", () => {
    const results: RepoResult[] = [
      result(TEMPLATE, { isTemplate: true }),
      result(DESK, { isTemplate: false }),
      result({ owner: "gaku", repo: "x" }, {}),
      { owner: "gaku", repo: "y", ok: false, error: { kind: "other", message: "x" } },
    ];
    expect(watchedTemplates(results)).toEqual([TEMPLATE]);
  });

  it("factorySignal は、テンプレートの「新サービス：」の Issue が閉じた・動いたら変わる", () => {
    const before = factorySignal([
      result(TEMPLATE, { isTemplate: true, issues: [issue(5, "新サービス：天気", "2026-11-16T01:00:00Z")] }),
    ]);
    const closed = factorySignal([
      result(TEMPLATE, {
        isTemplate: true,
        issues: [issue(5, "新サービス：天気", "2026-11-16T02:00:00Z", "closed")],
      }),
    ]);
    expect(before).not.toBe(closed);
    expect(before).not.toBe("");
  });

  it("factorySignal は、ほかの Issue・テンプレートでないリポジトリの変化では変わらない", () => {
    const quiet = factorySignal([result(TEMPLATE, { isTemplate: true })]);
    expect(
      factorySignal([
        result(TEMPLATE, { isTemplate: true, issues: [issue(6, "ボタンの色", "2026-11-16T02:00:00Z")] }),
        result(DESK, { isTemplate: false, issues: [issue(7, "新サービス：x", "2026-11-16T02:00:00Z")] }),
      ]),
    ).toBe(quiet);
  });
});

describe("updateRemovedRepos（外した物の記憶）", () => {
  const a = { owner: "gaku", repo: "a" };
  const b = { owner: "gaku", repo: "b" };

  it("前の一覧から消えた物を覚える", () => {
    expect(updateRemovedRepos([a, b], [a], [])).toEqual([b]);
  });

  it("手で足し直した物は記憶から消す（大文字小文字は区別しない）", () => {
    expect(updateRemovedRepos([a], [a, { owner: "Gaku", repo: "B" }], [b])).toEqual([]);
  });

  it("前に覚えた物は残し、重ねない", () => {
    expect(updateRemovedRepos([a, b], [a], [b])).toEqual([b]);
  });
});

describe("設定と足した記録の読み書き", () => {
  it("自動で足すのは初期でオン。`off` だけがオフ", () => {
    expect(parseAutoAddEnabled(null)).toBe(true);
    expect(parseAutoAddEnabled("on")).toBe(true);
    expect(parseAutoAddEnabled("何か")).toBe(true);
    expect(parseAutoAddEnabled(" OFF ")).toBe(false);
    expect(formatAutoAddEnabled(false)).toBe("off");
    expect(formatAutoAddEnabled(true)).toBe("on");
  });

  it("足した記録を読み書きする（形の合わない物は捨てる。最大件数を超えたら古い物から）", () => {
    const value = formatAddedLog([], [{ owner: "gaku", repo: "a" }], NOW);
    expect(value).toBe("gaku/a@2026-11-16T03:00:00.000Z");
    expect(parseAddedLog(`${value},broken,gaku/b@あした`)).toEqual([{ repo: "gaku/a", at: "2026-11-16T03:00:00.000Z" }]);
    const many = Array.from({ length: ADDED_LOG_MAX_ENTRIES }, (_, i) => ({ repo: `gaku/r${i}`, at: NOW.toISOString() }));
    const next = parseAddedLog(formatAddedLog(many, [{ owner: "gaku", repo: "new" }], NOW));
    expect(next).toHaveLength(ADDED_LOG_MAX_ENTRIES);
    expect(next.at(-1)?.repo).toBe("gaku/new");
    expect(next[0].repo).toBe("gaku/r1");
  });
});

describe("buildAddedNotices（いまの様子のお知らせ）", () => {
  const card = { owner: "gaku", repo: "morning-card" };

  it("足してから24時間の間、まだ監視している物を1つにつき1行（新しい時刻）で出す", () => {
    const entries = [
      { repo: "gaku/morning-card", at: "2026-11-16T01:00:00.000Z" },
      { repo: "gaku/morning-card", at: "2026-11-16T02:00:00.000Z" },
    ];
    const notices = buildAddedNotices(entries, [DESK, card], NOW);
    expect(notices).toEqual([{ ...card, at: "2026-11-16T02:00:00.000Z" }]);
    expect(addedNoticeText(notices[0])).toBe("morning-card を監視に追加しました");
  });

  it("24時間たった物・外した物は出さない", () => {
    const old = new Date(NOW.getTime() - ADDED_NOTICE_MS).toISOString();
    expect(buildAddedNotices([{ repo: "gaku/morning-card", at: old }], [card], NOW)).toEqual([]);
    expect(buildAddedNotices([{ repo: "gaku/morning-card", at: NOW.toISOString() }], [DESK], NOW)).toEqual([]);
  });
});
