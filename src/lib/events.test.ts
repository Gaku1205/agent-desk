import { describe, expect, it } from "vitest";
import {
  buildRecentEvents,
  dayHeading,
  EVENT_LIMIT,
  formatEventTime,
  groupEventsByDay,
  type RecentEvent,
} from "./events";
import type {
  CheckRunData,
  CommentData,
  IssueData,
  IssueEventData,
  PullData,
  RepoData,
  RepoResult,
} from "./github/types";

const NOW = new Date("2026-10-25T08:00:00Z"); // 日本時間 10月25日 17:00

function issue(number: number, overrides: Partial<IssueData> = {}): IssueData {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    labels: [],
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-25T00:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function pull(number: number, issueNumber: number, overrides: Partial<PullData> = {}): PullData {
  return {
    number,
    title: `PR ${number}`,
    body: `Closes #${issueNumber}`,
    state: "open",
    merged: false,
    labels: [],
    url: `https://github.com/o/r/pull/${number}`,
    headRef: `claude/issue-${issueNumber}-1`,
    headSha: `sha${number}`,
    mergeCommitSha: null,
    createdAt: "2026-10-25T01:00:00Z",
    updatedAt: "2026-10-25T01:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function check(overrides: Partial<CheckRunData> = {}): CheckRunData {
  return {
    name: "test",
    status: "completed",
    conclusion: "success",
    appSlug: "github-actions",
    completedAt: "2026-10-25T02:00:00Z",
    ...overrides,
  };
}

let nextId = 1;
function comment(issueNumber: number, body: string, createdAt: string): CommentData {
  return { id: nextId++, issueNumber, author: "claude[bot]", body, createdAt };
}

function labeled(label: string, issueNumber: number, createdAt: string): IssueEventData {
  return { event: "labeled", labelName: label, issueNumber, createdAt };
}

function repo(data: Partial<RepoData>): RepoResult[] {
  return [
    {
      owner: "o",
      repo: "r",
      ok: true,
      data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...data },
    },
  ];
}

function build(data: Partial<RepoData>): RecentEvent[] {
  return buildRecentEvents(repo(data), NOW);
}

function find(events: RecentEvent[], text: string): RecentEvent | undefined {
  return events.find((event) => event.text.includes(text));
}

describe("buildRecentEvents の種類", () => {
  it("ai:implement が付いた：あなたがした操作", () => {
    const events = build({
      issues: [issue(3, { title: "ホーム" })],
      events: [labeled("ai:implement", 3, "2026-10-25T01:00:00Z")],
    });
    expect(events).toEqual([
      {
        id: expect.any(String),
        at: "2026-10-25T01:00:00Z",
        tone: "operation",
        icon: "play",
        text: "「ホーム」の実装を依頼しました",
        ref: "r#3",
      },
    ]);
  });

  it("他のラベルや他のIssueのイベントは出さない", () => {
    const events = build({
      issues: [issue(3)],
      events: [
        labeled("bug", 3, "2026-10-25T01:00:00Z"),
        labeled("ai:implement", 9, "2026-10-25T01:00:00Z"),
      ],
    });
    expect(events).toEqual([]);
  });

  it("実装AIの完了コメント：人間の番になった", () => {
    const events = build({
      issues: [issue(3)],
      comments: [comment(3, "**Claude finished @x's task**", "2026-10-25T01:00:00Z")],
    });
    expect(events[0]).toMatchObject({
      tone: "human",
      icon: "check",
      text: "AIが実装を終えました。PRを作れます",
      ref: "r#3",
    });
  });

  it("実装AIのエラーコメント：人間の番になった（×）", () => {
    const events = build({
      issues: [issue(3)],
      comments: [comment(3, "**Claude encountered an error**", "2026-10-25T01:00:00Z")],
    });
    expect(events[0]).toMatchObject({
      tone: "human",
      icon: "x",
      text: "AIがエラーで止まりました",
      ref: "r#3",
    });
  });

  it("PRができた：PRの createdAt", () => {
    const events = build({ issues: [issue(3)], pulls: [pull(8, 3)] });
    expect(events).toEqual([
      expect.objectContaining({
        at: "2026-10-25T01:00:00Z",
        tone: "ai",
        icon: "pr",
        text: "PRができました",
        ref: "r#3・PR #8",
      }),
    ]);
  });

  it("CIが全部通った：いちばん遅い completed_at、Claude Reviewは数えない", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      pullChecks: {
        8: {
          checkRuns: [
            check({ name: "a", completedAt: "2026-10-25T02:00:00Z" }),
            check({ name: "b", completedAt: "2026-10-25T02:30:00Z" }),
            check({ name: "review", completedAt: "2026-10-25T05:00:00Z" }),
          ],
          statuses: [],
        },
      },
    });
    expect(find(events, "CIが通りました")).toMatchObject({
      at: "2026-10-25T02:30:00Z",
      tone: "ai",
      icon: "check",
      text: "CIが通りました（2/2）",
      ref: "r・PR #8",
    });
  });

  it("CIが失敗した：失敗したチェックの completed_at と名前", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      pullChecks: {
        8: {
          checkRuns: [
            check({ name: "lint", conclusion: "failure", completedAt: "2026-10-25T02:10:00Z" }),
            check({ name: "build", completedAt: "2026-10-25T02:40:00Z" }),
          ],
          statuses: [],
        },
      },
    });
    expect(find(events, "CIが失敗")).toMatchObject({
      at: "2026-10-25T02:10:00Z",
      tone: "fail",
      icon: "x",
      text: "CIが失敗しました（lint）",
      ref: "r・PR #8",
    });
    expect(find(events, "CIが通りました")).toBeUndefined();
  });

  it("CIが実行中なら出さない", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      pullChecks: {
        8: {
          checkRuns: [check({ status: "in_progress", conclusion: null, completedAt: null })],
          statuses: [],
        },
      },
    });
    expect(events.map((event) => event.text)).toEqual(["PRができました"]);
  });

  it("ai:review が付いた：PRに付いた物は紐づくIssueの出来事", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      events: [labeled("ai:review", 8, "2026-10-25T03:00:00Z")],
    });
    expect(find(events, "レビューを依頼")).toMatchObject({
      tone: "operation",
      icon: "eye",
      ref: "r・PR #8",
    });
  });

  it("レビューAIが終わった：skipped 以外で完了した Claude Review の completed_at", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      pullChecks: {
        8: {
          checkRuns: [
            check({ name: "review", completedAt: "2026-10-25T04:00:00Z" }),
            check({ name: "review", conclusion: "skipped", completedAt: "2026-10-25T06:00:00Z" }),
          ],
          statuses: [],
        },
      },
    });
    expect(find(events, "レビューAI")).toMatchObject({
      at: "2026-10-25T04:00:00Z",
      tone: "ai",
      icon: "eye",
      text: "レビューAIが確認を終えました",
    });
  });

  it("skipped だけならレビューAIの出来事は出さない", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      pullChecks: {
        8: {
          checkRuns: [check({ name: "review", conclusion: "skipped" })],
          statuses: [],
        },
      },
    });
    expect(find(events, "レビューAI")).toBeUndefined();
  });

  const merged = pull(8, 3, {
    state: "closed",
    merged: true,
    mergedAt: "2026-10-25T05:00:00Z",
    mergeCommitSha: "m1",
  });

  it("マージされた（ai:hold）：あなたがした操作", () => {
    const events = build({
      issues: [issue(3, { title: "ホーム", state: "closed" })],
      pulls: [{ ...merged, labels: ["ai:hold"] }],
    });
    expect(find(events, "マージ")).toMatchObject({
      at: "2026-10-25T05:00:00Z",
      tone: "operation",
      icon: "merge",
      text: "「ホーム」をマージしました",
      ref: "r#3・PR #8",
    });
  });

  it("自動マージ：ai:hold が無いマージは自動でマージした出来事", () => {
    const events = build({
      issues: [issue(3, { title: "ホーム", state: "closed" })],
      pulls: [merged],
    });
    expect(find(events, "マージ")).toMatchObject({
      tone: "ai",
      icon: "merge",
      text: "「ホーム」を自動でマージしました",
    });
  });

  it("本番に公開された：Vercel のステータスの updated_at", () => {
    const events = build({
      issues: [issue(3, { title: "ホーム", state: "closed" })],
      pulls: [merged],
      pullChecks: {
        8: {
          checkRuns: [],
          statuses: [
            { context: "Vercel", state: "success", updatedAt: "2026-10-25T05:03:00Z" },
            { context: "other", state: "failure", updatedAt: "2026-10-25T05:04:00Z" },
          ],
        },
      },
    });
    expect(find(events, "公開")).toMatchObject({
      at: "2026-10-25T05:03:00Z",
      tone: "deployed",
      icon: "up",
      text: "「ホーム」が本番に公開されました",
      ref: "r#3・PR #8",
    });
    expect(events.filter((event) => event.tone === "fail")).toEqual([]);
  });

  it("公開に失敗した", () => {
    const events = build({
      issues: [issue(3, { title: "ホーム", state: "closed" })],
      pulls: [merged],
      pullChecks: {
        8: {
          checkRuns: [],
          statuses: [{ context: "Vercel", state: "error", updatedAt: "2026-10-25T05:03:00Z" }],
        },
      },
    });
    expect(find(events, "公開")).toMatchObject({
      tone: "fail",
      icon: "x",
      text: "「ホーム」の公開に失敗しました",
    });
  });

  it("公開中（pending）の間は出さない", () => {
    const events = build({
      issues: [issue(3, { state: "closed" })],
      pulls: [merged],
      pullChecks: {
        8: {
          checkRuns: [],
          statuses: [{ context: "Vercel", state: "pending", updatedAt: "2026-10-25T05:03:00Z" }],
        },
      },
    });
    expect(find(events, "公開")).toBeUndefined();
  });

  it("自動修正：修正依頼コメントごとに n/2", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      comments: [
        comment(8, "@claude 直して\n<!-- auto-fix -->\n<!-- auto-fix-sha: aaa -->", "2026-10-25T03:00:00Z"),
        comment(8, "@claude 直して\n<!-- auto-fix -->\n<!-- auto-fix-sha: bbb -->", "2026-10-25T04:00:00Z"),
      ],
    });
    const fixes = events.filter((event) => event.text.startsWith("AIに修正"));
    expect(fixes.map((event) => event.text)).toEqual([
      "AIに修正を依頼しました（2/2）",
      "AIに修正を依頼しました（1/2）",
    ]);
    expect(fixes[0]).toMatchObject({ tone: "ai", ref: "r#3・PR #8" });
  });

  it("止まった：PRの「⏸ 自動で進めるのを止めました」コメントの理由", () => {
    const events = build({
      issues: [issue(3)],
      pulls: [pull(8, 3)],
      comments: [
        comment(8, "⏸ 自動で進めるのを止めました：CIが失敗しました\n\n確認して…", "2026-10-25T06:00:00Z"),
      ],
    });
    expect(find(events, "止めました")).toMatchObject({
      at: "2026-10-25T06:00:00Z",
      tone: "human",
      icon: "x",
      text: "自動で進めるのを止めました：CIが失敗しました",
      ref: "r#3・PR #8",
    });
  });

  it("表示しないIssue（閉じていてマージ済みPRも無い）の出来事は出さない", () => {
    const events = build({
      issues: [issue(3, { state: "closed" })],
      events: [labeled("ai:implement", 3, "2026-10-25T01:00:00Z")],
    });
    expect(events).toEqual([]);
  });

  it("取得に失敗したリポジトリは飛ばす", () => {
    const results: RepoResult[] = [
      { owner: "o", repo: "x", ok: false, error: { kind: "other", message: "失敗" } },
    ];
    expect(buildRecentEvents(results, NOW)).toEqual([]);
  });
});

describe("buildRecentEvents の上限", () => {
  it("直近3日より前の出来事は出さない（ちょうど3日前は出す）", () => {
    const events = build({
      issues: [issue(1), issue(2), issue(3)],
      events: [
        labeled("ai:implement", 1, "2026-10-22T08:00:00Z"),
        labeled("ai:implement", 2, "2026-10-22T07:59:59Z"),
        labeled("ai:implement", 3, "2026-10-25T07:59:59Z"),
      ],
    });
    expect(events.map((event) => event.ref)).toEqual(["r#3", "r#1"]);
  });

  it("未来の時刻は出さない", () => {
    const events = build({
      issues: [issue(1)],
      events: [labeled("ai:implement", 1, "2026-10-25T08:00:01Z")],
    });
    expect(events).toEqual([]);
  });

  it("新しい順に並べ、最大50件にする", () => {
    const count = EVENT_LIMIT + 10;
    const issues = Array.from({ length: count }, (_, i) => issue(i + 1));
    const events = issues.map((item, i) =>
      labeled("ai:implement", item.number, new Date(Date.UTC(2026, 9, 25, 0, i)).toISOString()),
    );
    const result = build({ issues, events });
    expect(result).toHaveLength(EVENT_LIMIT);
    expect(result[0].ref).toBe(`r#${count}`);
    expect(result.at(-1)?.ref).toBe(`r#${count - EVENT_LIMIT + 1}`);
    const times = result.map((event) => event.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("複数のリポジトリをまとめて新しい順に並べる", () => {
    const results: RepoResult[] = ["a", "b"].map((name, i) => ({
      owner: "o",
      repo: name,
      ok: true,
      data: {
        issues: [issue(1)],
        pulls: [],
        comments: [],
        pullChecks: {},
        events: [labeled("ai:implement", 1, `2026-10-25T0${i + 1}:00:00Z`)],
      },
    }));
    expect(buildRecentEvents(results, NOW).map((event) => event.ref)).toEqual(["b#1", "a#1"]);
  });
});

describe("日の見出し（日本時間）", () => {
  it("今日・昨日・それより前は「10月23日」", () => {
    expect(dayHeading("2026-10-25T00:00:00Z", NOW)).toBe("今日");
    expect(dayHeading("2026-10-24T03:00:00Z", NOW)).toBe("昨日");
    expect(dayHeading("2026-10-23T03:00:00Z", NOW)).toBe("10月23日");
    expect(dayHeading("2026-10-02T03:00:00Z", NOW)).toBe("10月2日");
  });

  it("日付の境目は日本時間の0時", () => {
    // UTC 10月24日 15:00 = 日本時間 10月25日 0:00（今日）
    expect(dayHeading("2026-10-24T15:00:00Z", NOW)).toBe("今日");
    // UTC 10月24日 14:59 = 日本時間 10月24日 23:59（昨日）
    expect(dayHeading("2026-10-24T14:59:00Z", NOW)).toBe("昨日");
  });

  it("「今」が日本時間で翌日になっていても、日本時間で数える", () => {
    const now = new Date("2026-10-25T16:00:00Z"); // 日本時間 10月26日 1:00
    expect(dayHeading("2026-10-25T10:00:00Z", now)).toBe("昨日");
    expect(dayHeading("2026-10-24T10:00:00Z", now)).toBe("10月24日");
  });

  it("時刻は日本時間の HH:MM", () => {
    expect(formatEventTime("2026-10-25T07:57:30Z")).toBe("16:57");
    expect(formatEventTime("2026-10-24T15:05:00Z")).toBe("00:05");
  });

  it("日ごとにまとめる（新しい順のまま）", () => {
    const event = (id: string, at: string): RecentEvent => ({
      id,
      at,
      tone: "ai",
      icon: "pr",
      text: id,
      ref: "r#1",
    });
    const days = groupEventsByDay(
      [
        event("a", "2026-10-25T07:00:00Z"),
        event("b", "2026-10-25T01:00:00Z"),
        event("c", "2026-10-24T05:00:00Z"),
        event("d", "2026-10-23T05:00:00Z"),
      ],
      NOW,
    );
    expect(days.map((day) => day.heading)).toEqual(["今日", "昨日", "10月23日"]);
    expect(days.map((day) => day.events.map((e) => e.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("0件なら空", () => {
    expect(groupEventsByDay([], NOW)).toEqual([]);
  });
});
