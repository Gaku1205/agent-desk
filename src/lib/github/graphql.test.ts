import { describe, expect, it } from "vitest";
import {
  convertCheckRun,
  convertComment,
  convertIssue,
  convertIssueEvent,
  convertPull,
  convertStatus,
} from "./convert";
import { gqlIssue, gqlPull } from "./fakeGitHub";
import {
  convertGqlCheckRuns,
  convertGqlComments,
  convertGqlIssue,
  convertGqlLabelEvents,
  convertGqlPull,
  convertGqlPullChecks,
  convertRepoNodes,
  convertStatuses,
  mainDeployedFrom,
  readRepoResponse,
  REPO_QUERY,
} from "./graphql";

const CUTOFF = Date.parse("2026-10-11T00:00:00Z");

describe("GraphQL の返事 → 今の型（REST からの変換と同じ結果）", () => {
  it("Issue", () => {
    const rest = convertIssue({
      number: 12,
      title: "直す",
      body: "> 元のメモ：x",
      state: "closed",
      labels: [{ name: "ai:implement" }, { name: "bug" }],
      html_url: "https://github.com/o/r/issues/12",
      created_at: "2026-10-20T00:00:00Z",
      updated_at: "2026-10-21T00:00:00Z",
      closed_at: "2026-10-21T00:00:00Z",
    });
    const gql = convertGqlIssue(
      gqlIssue(12, {
        title: "直す",
        body: "> 元のメモ：x",
        state: "CLOSED",
        labels: { nodes: [{ name: "ai:implement" }, { name: "bug" }] },
        url: "https://github.com/o/r/issues/12",
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-21T00:00:00Z",
        closedAt: "2026-10-21T00:00:00Z",
      }),
    );
    expect(gql).toEqual(rest);
  });

  it("開いているPRとマージ済みのPR", () => {
    const restOpen = convertPull({
      number: 3,
      title: "PR 3",
      body: "Closes #2",
      state: "open",
      merged_at: null,
      labels: [{ name: "ai:review" }],
      html_url: "https://github.com/o/r/pull/3",
      head: { ref: "claude/issue-2-x", sha: "abc" },
      merge_commit_sha: null,
      created_at: "2026-10-20T00:00:00Z",
      updated_at: "2026-10-21T00:00:00Z",
    });
    const gqlOpen = convertGqlPull(
      gqlPull(3, {
        body: "Closes #2",
        labels: { nodes: [{ name: "ai:review" }] },
        headRefName: "claude/issue-2-x",
        headRefOid: "abc",
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-21T00:00:00Z",
      }),
    );
    expect(gqlOpen).toEqual(restOpen);

    const restMerged = convertPull({
      number: 4,
      title: "PR 4",
      body: "",
      state: "closed",
      merged_at: "2026-10-22T00:00:00Z",
      labels: [],
      html_url: "https://github.com/o/r/pull/4",
      head: { ref: "claude/issue-4-x", sha: "head-4" },
      merge_commit_sha: "merge-4",
      created_at: "2026-10-24T00:00:00Z",
      updated_at: "2026-10-24T00:00:00Z",
    });
    const gqlMerged = convertGqlPull(
      gqlPull(4, { merged: true, mergedAt: "2026-10-22T00:00:00Z" }),
    );
    expect(gqlMerged).toEqual(restMerged);
  });

  it("閉じた（未マージ）PR は closed でマージ済みでない", () => {
    const pull = convertGqlPull(gqlPull(5, { state: "CLOSED" }));
    expect(pull.state).toBe("closed");
    expect(pull.merged).toBe(false);
    expect(pull.mergeCommitSha).toBeNull();
  });

  it("コメント：Bot のログイン名には [bot] を付ける（REST と同じ）", () => {
    const rest = [
      convertComment({
        id: 101,
        issue_url: "https://api.github.com/repos/o/r/issues/7",
        body: "Claude finished",
        user: { login: "claude[bot]" },
        created_at: "2026-10-20T00:00:00Z",
      }),
      convertComment({
        id: 102,
        issue_url: "https://api.github.com/repos/o/r/issues/7",
        body: "ok",
        user: { login: "gaku" },
        created_at: "2026-10-20T01:00:00Z",
      }),
      convertComment({
        id: 103,
        issue_url: "https://api.github.com/repos/o/r/issues/7",
        body: null,
        user: null,
        created_at: "2026-10-20T02:00:00Z",
      }),
    ];
    const gql = convertGqlComments(
      7,
      gqlIssue(7, {
        comments: {
          nodes: [
            {
              databaseId: 101,
              body: "Claude finished",
              createdAt: "2026-10-20T00:00:00Z",
              author: { __typename: "Bot", login: "claude" },
            },
            {
              databaseId: 102,
              body: "ok",
              createdAt: "2026-10-20T01:00:00Z",
              author: { __typename: "User", login: "gaku" },
            },
            { databaseId: 103, body: null, createdAt: "2026-10-20T02:00:00Z", author: null },
          ],
        },
      }),
    );
    expect(gql).toEqual(rest);
  });

  it("ラベルの付け外し → issues/events と同じ形", () => {
    const rest = [
      convertIssueEvent({
        event: "labeled",
        label: { name: "ai:implement" },
        issue: { number: 7 },
        created_at: "2026-10-20T00:00:00Z",
      }),
      convertIssueEvent({
        event: "unlabeled",
        label: { name: "ai:plan" },
        issue: { number: 7 },
        created_at: "2026-10-20T00:01:00Z",
      }),
    ];
    const gql = convertGqlLabelEvents(
      7,
      gqlIssue(7, {
        timelineItems: {
          nodes: [
            { __typename: "LabeledEvent", createdAt: "2026-10-20T00:00:00Z", label: { name: "ai:implement" } },
            { __typename: "UnlabeledEvent", createdAt: "2026-10-20T00:01:00Z", label: { name: "ai:plan" } },
            { __typename: "SomethingElse", createdAt: "2026-10-20T00:02:00Z" },
          ],
        },
      }),
    );
    expect(gql).toEqual(rest);
  });

  it("チェックラン：英字は小文字にし、作ったアプリを持つ。CheckRun 以外は除く", () => {
    const rest = [
      convertCheckRun({
        name: "test",
        status: "completed",
        conclusion: "success",
        app: { slug: "github-actions" },
        completed_at: "2026-10-20T01:00:00Z",
      }),
      convertCheckRun({ name: "review", status: "in_progress", conclusion: null, app: null }),
    ];
    const gql = convertGqlCheckRuns(
      gqlPull(1, {
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [
                      {
                        __typename: "CheckRun",
                        name: "test",
                        status: "COMPLETED",
                        conclusion: "SUCCESS",
                        completedAt: "2026-10-20T01:00:00Z",
                        checkSuite: { app: { slug: "github-actions" } },
                      },
                      { __typename: "CheckRun", name: "review", status: "IN_PROGRESS", conclusion: null },
                      { __typename: "StatusContext" },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    );
    expect(gql).toEqual(rest);
  });

  it("コミットステータス：時刻は createdAt、リンク先はあれば持つ", () => {
    const rest = [
      convertStatus({
        context: "Vercel",
        state: "success",
        description: "Deployment has completed",
        target_url: "https://x.vercel.app",
        updated_at: "2026-10-21T00:05:00Z",
      }),
      convertStatus({ context: "deploy/expo", state: "error", description: null, updated_at: "2026-10-21T00:06:00Z" }),
    ];
    const gql = convertStatuses({
      contexts: [
        {
          context: "Vercel",
          state: "SUCCESS",
          description: "Deployment has completed",
          targetUrl: "https://x.vercel.app",
          createdAt: "2026-10-21T00:05:00Z",
        },
        { context: "deploy/expo", state: "ERROR", description: null, targetUrl: null, createdAt: "2026-10-21T00:06:00Z" },
      ],
    });
    expect(gql).toEqual(rest);
  });
});

describe("convertGqlPullChecks（チェックを持たせるPR）", () => {
  const runs = {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: { nodes: [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" }] },
          },
        },
      },
    ],
  };
  const check = (raw: ReturnType<typeof gqlPull>) => convertGqlPullChecks(raw, convertGqlPull(raw));

  it("開いているPRは先頭コミットのチェックランだけ", () => {
    const checks = check(gqlPull(1, { commits: runs }));
    expect(checks?.checkRuns.map((r) => r.name)).toEqual(["test"]);
    expect(checks?.statuses).toEqual([]);
  });

  it("マージ済みのPRは先頭コミットのチェックランとマージコミットの公開ステータスの両方", () => {
    const checks = check(
      gqlPull(2, { merged: true, commits: runs, statuses: [{ context: "Vercel", state: "SUCCESS", createdAt: "t" }] }),
    );
    expect(checks?.checkRuns.map((r) => r.name)).toEqual(["test"]);
    expect(checks?.statuses.map((s) => s.state)).toEqual(["success"]);
  });

  it("閉じた（未マージ）PRと、Issueに紐づかないPRは持たない", () => {
    expect(check(gqlPull(3, { state: "CLOSED", commits: runs }))).toBeNull();
    expect(check(gqlPull(4, { headRefName: "pipeline-sync/4", commits: runs }))).toBeNull();
    expect(check(gqlPull(5, { headRefName: "feature/y", body: "Closes #5", commits: runs }))).not.toBeNull();
  });
});

describe("convertRepoNodes", () => {
  it("直近14日に絞り、コメントは作成の順、PRのコメントとラベルの付け外しも入れる", () => {
    const data = convertRepoNodes(
      [
        gqlIssue(1, {
          updatedAt: "2026-10-20T00:00:00Z",
          comments: {
            nodes: [
              { databaseId: 2, createdAt: "2026-10-12T00:00:00Z", author: { __typename: "User", login: "a" } },
              { databaseId: 1, createdAt: "2026-10-10T00:00:00Z", author: { __typename: "User", login: "a" } },
            ],
          },
        }),
        gqlIssue(2, { updatedAt: "2026-10-10T23:00:00Z" }),
      ],
      [
        gqlPull(3, {
          comments: { nodes: [{ databaseId: 3, createdAt: "2026-10-11T06:00:00Z", author: null }] },
          timelineItems: {
            nodes: [{ __typename: "LabeledEvent", createdAt: "2026-10-21T00:00:00Z", label: { name: "ai:review" } }],
          },
        }),
        gqlPull(4, { updatedAt: "2026-10-01T00:00:00Z" }),
      ],
      CUTOFF,
    );
    expect(data.issues.map((i) => i.number)).toEqual([1]);
    expect(data.pulls.map((p) => p.number)).toEqual([3]);
    expect(data.comments.map((c) => [c.id, c.issueNumber])).toEqual([
      [3, 3],
      [2, 1],
    ]);
    expect(data.events).toEqual([
      { event: "labeled", labelName: "ai:review", issueNumber: 3, createdAt: "2026-10-21T00:00:00Z" },
    ]);
    expect(Object.keys(data.pullChecks)).toEqual(["3"]);
  });
});

describe("mainDeployedFrom（main の最後に公開が成功した時刻）", () => {
  const success = (at: string, description = "", context = "Vercel") => ({
    context,
    state: "success",
    description,
    updatedAt: at,
  });
  const pending = { context: "Vercel", state: "pending", description: "", updatedAt: "2026-10-21T03:00:00Z" };

  it("いちばん新しいコミットが pending でも、1つ前のコミットが success ならその時刻を使う", () => {
    expect(mainDeployedFrom([[pending], [success("2026-10-21T02:00:00Z")]]).at).toBe("2026-10-21T02:00:00Z");
  });

  it("Ignored Build Step の success は数えず、そのさきの success を使う", () => {
    const found = mainDeployedFrom([
      [success("2026-10-21T03:00:00Z", " Canceled by Ignored Build Step ")],
      [success("2026-10-21T02:00:00Z", "Deployment has completed")],
    ]);
    expect(found.at).toBe("2026-10-21T02:00:00Z");
  });

  it("context ごとに、新しいコミットの値を優先する。成功が無ければ null", () => {
    const found = mainDeployedFrom([
      [success("2026-10-21T05:00:00Z", "", "deploy/expo"), pending],
      [success("2026-10-21T04:00:00Z", "", "deploy/expo"), success("2026-10-21T01:00:00Z")],
    ]);
    expect(found.byContext).toEqual({ "deploy/expo": "2026-10-21T05:00:00Z", Vercel: "2026-10-21T01:00:00Z" });
    expect(mainDeployedFrom([[pending]])).toEqual({ at: null, byContext: {} });
  });
});

describe("readRepoResponse", () => {
  it("続きがあるときだけカーソルを返す。repository が無ければ null", () => {
    const read = readRepoResponse({
      repository: {
        isTemplate: true,
        issues: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [gqlIssue(1), null] },
        pullRequests: { pageInfo: { hasNextPage: false, endCursor: "c2" }, nodes: [] },
        ref: null,
      },
    });
    expect(read?.isTemplate).toBe(true);
    expect(read?.issues).toEqual({ nodes: [gqlIssue(1)], next: "c1" });
    expect(read?.pulls).toEqual({ nodes: [], next: null });
    expect(read?.mainCommits).toBeNull();
    expect(readRepoResponse({ repository: null })).toBeNull();
    expect(readRepoResponse(null)).toBeNull();
  });
});

describe("REPO_QUERY", () => {
  it("回数制限・Issue・PR・main・isTemplate を1回の問い合わせに入れる", () => {
    for (const part of ["rateLimit { cost remaining resetAt }", "isTemplate", "issues(", "pullRequests(", "statusCheckRollup", "mergeCommit", "refs/heads/main", "timelineItems"]) {
      expect(REPO_QUERY).toContain(part);
    }
  });
});
