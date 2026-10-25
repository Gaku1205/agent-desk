import { describe, expect, it } from "vitest";
import {
  convertCheckRun,
  convertComment,
  convertIssue,
  convertIssueEvent,
  convertPull,
  convertStatus,
} from "./convert";

describe("convertIssue", () => {
  const base = {
    number: 3,
    title: "題",
    body: null,
    state: "open",
    labels: [{ name: "ai:implement" }, "ai:hold", { name: null }],
    html_url: "https://github.com/o/r/issues/3",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    closed_at: null,
  };

  it("ラベル名と本文の null を直す", () => {
    expect(convertIssue(base)).toEqual({
      number: 3,
      title: "題",
      body: "",
      state: "open",
      labels: ["ai:implement", "ai:hold"],
      url: "https://github.com/o/r/issues/3",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z",
      closedAt: null,
    });
  });

  it("PRは除く", () => {
    expect(convertIssue({ ...base, pull_request: {} })).toBeNull();
  });
});

describe("convertPull", () => {
  it("マージ済みかどうかとブランチ・コミットを取る", () => {
    const pull = convertPull({
      number: 5,
      title: "PR",
      body: "Closes #3",
      state: "closed",
      merged_at: "2026-10-03T00:00:00Z",
      labels: [{ name: "ai:review" }],
      html_url: "https://github.com/o/r/pull/5",
      head: { ref: "claude/issue-3-x", sha: "abc" },
      merge_commit_sha: "def",
      created_at: "2026-10-02T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    });
    expect(pull).toMatchObject({
      merged: true,
      state: "closed",
      headRef: "claude/issue-3-x",
      headSha: "abc",
      mergeCommitSha: "def",
      mergedAt: "2026-10-03T00:00:00Z",
      labels: ["ai:review"],
    });
  });

  it("マージされていないPRは merged が false", () => {
    const pull = convertPull({
      number: 6,
      title: "PR",
      state: "open",
      html_url: "u",
      head: { ref: "b", sha: "s" },
      created_at: "a",
      updated_at: "b",
    });
    expect(pull.merged).toBe(false);
    expect(pull.mergedAt).toBeNull();
    expect(pull.mergeCommitSha).toBeNull();
  });
});

describe("convertComment", () => {
  it("issue_url から番号を取る", () => {
    expect(
      convertComment({
        id: 1,
        issue_url: "https://api.github.com/repos/o/r/issues/12",
        body: "Claude finished",
        user: { login: "claude[bot]" },
        created_at: "t",
      }),
    ).toEqual({
      id: 1,
      issueNumber: 12,
      author: "claude[bot]",
      body: "Claude finished",
      createdAt: "t",
    });
  });

  it("番号が取れなければ null", () => {
    expect(convertComment({ id: 1, issue_url: "x", created_at: "t" })).toBeNull();
  });
});

describe("convertCheckRun", () => {
  it("app.slug と completed_at を取る", () => {
    expect(
      convertCheckRun({
        name: "test",
        status: "completed",
        conclusion: "success",
        app: { slug: "github-actions" },
        completed_at: "2026-10-02T01:00:00Z",
      }),
    ).toEqual({
      name: "test",
      status: "completed",
      conclusion: "success",
      appSlug: "github-actions",
      completedAt: "2026-10-02T01:00:00Z",
    });
  });

  it("実行中でアプリ情報が無ければ null にする", () => {
    expect(convertCheckRun({ name: "x", status: "in_progress" })).toEqual({
      name: "x",
      status: "in_progress",
      conclusion: null,
      appSlug: null,
      completedAt: null,
    });
  });
});

describe("convertStatus", () => {
  it("updated_at を取る", () => {
    expect(
      convertStatus({ context: "Vercel", state: "success", updated_at: "2026-10-03T00:05:00Z" }),
    ).toEqual({ context: "Vercel", state: "success", updatedAt: "2026-10-03T00:05:00Z" });
  });
});

describe("convertIssueEvent", () => {
  it("ラベル名と番号を取る", () => {
    expect(
      convertIssueEvent({
        event: "labeled",
        label: { name: "ai:implement" },
        issue: { number: 3 },
        created_at: "t",
      }),
    ).toEqual({ event: "labeled", labelName: "ai:implement", issueNumber: 3, createdAt: "t" });
  });

  it("ラベルもIssueも無ければ null", () => {
    expect(convertIssueEvent({ event: "closed", created_at: "t" })).toEqual({
      event: "closed",
      labelName: null,
      issueNumber: null,
      createdAt: "t",
    });
  });
});
