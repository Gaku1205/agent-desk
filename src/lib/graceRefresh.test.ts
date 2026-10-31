import { describe, expect, it } from "vitest";
import type { CommentData, IssueData, RepoData, RepoResult } from "./github/types";
import { GRACE_REFRESH_MARGIN_MS, graceRefreshAt, nextGraceEnd } from "./graceRefresh";
import { graceEndsAt, INTAKE_GRACE_MS, PULL_GRACE_MS } from "./status";

const NOW = new Date("2026-10-25T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const issue = (number: number, createdAt: string, labels: string[] = []): IssueData => ({
  number,
  title: `Issue ${number}`,
  body: "",
  state: "open",
  labels,
  url: "",
  createdAt,
  updatedAt: createdAt,
  closedAt: null,
});

const doneComment = (issueNumber: number, createdAt: string): CommentData => ({
  id: issueNumber,
  issueNumber,
  author: "claude[bot]",
  body: "**Claude finished**",
  createdAt,
});

const repo = (
  issues: IssueData[],
  comments: CommentData[] = [],
  pipeline: RepoData["pipeline"] = "running",
): RepoResult => ({
  owner: "o",
  repo: "r",
  ok: true,
  data: { issues, pulls: [], comments, pullChecks: {}, events: [], pipeline },
});

describe("graceEndsAt", () => {
  it("猶予の中なら since + graceMs", () => {
    const end = graceEndsAt(minutesAgo(3), NOW, INTAKE_GRACE_MS);
    expect(end?.toISOString()).toBe(new Date(NOW.getTime() + 7 * 60_000).toISOString());
  });

  it("ちょうど graceMs たったら猶予は終わっている（null）", () => {
    expect(graceEndsAt(minutesAgo(10), NOW, INTAKE_GRACE_MS)).toBeNull();
  });

  it("時刻が読めないときは null", () => {
    expect(graceEndsAt("not a date", NOW, INTAKE_GRACE_MS)).toBeNull();
  });
});

describe("nextGraceEnd", () => {
  it("猶予の中の物が無ければ null", () => {
    expect(nextGraceEnd([repo([issue(1, minutesAgo(30))])], NOW)).toBeNull();
    expect(nextGraceEnd([], NOW)).toBeNull();
  });

  it("未着手の猶予は作成から10分で終わる", () => {
    const end = nextGraceEnd([repo([issue(1, minutesAgo(4))])], NOW);
    expect(end?.getTime()).toBe(NOW.getTime() + 6 * 60_000);
  });

  it("PR作成待ちの猶予は完了コメントから15分で終わる", () => {
    const end = nextGraceEnd(
      [repo([issue(1, minutesAgo(60), ["ai:implement"])], [doneComment(1, minutesAgo(5))])],
      NOW,
    );
    expect(end?.getTime()).toBe(NOW.getTime() + (PULL_GRACE_MS - 5 * 60_000));
  });

  it("複数あるときは一番早い時刻", () => {
    const end = nextGraceEnd(
      [
        repo([issue(1, minutesAgo(1)), issue(2, minutesAgo(8))]),
        repo([issue(3, minutesAgo(60))], [doneComment(3, minutesAgo(2))]),
      ],
      NOW,
    );
    expect(end?.getTime()).toBe(NOW.getTime() + 2 * 60_000);
  });

  it("時刻が読めない物は無視する", () => {
    const end = nextGraceEnd([repo([issue(1, "broken"), issue(2, minutesAgo(9))])], NOW);
    expect(end?.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("パイプラインが動いていなければ猶予は無い", () => {
    expect(nextGraceEnd([repo([issue(1, minutesAgo(1))], [], "notConfigured")], NOW)).toBeNull();
  });

  it("取れなかったリポジトリは飛ばす", () => {
    const failed: RepoResult = {
      owner: "o",
      repo: "x",
      ok: false,
      error: { kind: "other", message: "" },
    };
    expect(nextGraceEnd([failed], NOW)).toBeNull();
  });
});

describe("graceRefreshAt", () => {
  it("猶予が終わる時刻の1秒後", () => {
    expect(graceRefreshAt(NOW).getTime() - NOW.getTime()).toBe(GRACE_REFRESH_MARGIN_MS);
  });
});
