import { describe, expect, it } from "vitest";
import { buildRecentEvents, deployFootprint } from "./events";
import type { CommitStatusData, IssueData, PullData, RepoData } from "./github/types";
import { latestSuccessDeployByContext } from "./status";

const NOW = new Date("2026-10-25T08:00:00Z");
const MERGED = "2026-10-25T05:00:00Z";

function status(
  context: string,
  state: string,
  updatedAt = "2026-10-25T05:03:00Z",
  description = "",
): CommitStatusData {
  return { context, state, description, updatedAt };
}

describe("deployFootprint：あとの公開", () => {
  it("失敗でも、同じ context のあとの成功がマージより後なら、その時刻で成功", () => {
    expect(deployFootprint([status("Vercel", "error")], MERGED, { Vercel: "2026-10-25T07:00:00Z" })).toEqual({
      result: "success",
      at: "2026-10-25T07:00:00Z",
    });
  });

  it("成功の時刻がマージと同じ・前なら、失敗のまま", () => {
    for (const at of [MERGED, "2026-10-25T04:00:00Z"]) {
      expect(deployFootprint([status("Vercel", "failure")], MERGED, { Vercel: at })).toEqual({
        result: "failure",
        at: "2026-10-25T05:03:00Z",
      });
    }
  });

  it("context が違う成功では解決しない", () => {
    expect(
      deployFootprint([status("deploy/aws-apprunner", "failure")], MERGED, { Vercel: "2026-10-25T07:00:00Z" }),
    ).toMatchObject({ result: "failure" });
  });

  it("あとの公開が無ければ失敗", () => {
    expect(deployFootprint([status("Vercel", "failure")], MERGED, {})).toMatchObject({ result: "failure" });
    expect(deployFootprint([status("Vercel", "failure")], MERGED, null)).toMatchObject({ result: "failure" });
  });

  it("公開の状態が無くても、マージより後の成功のうち最新で成功", () => {
    expect(
      deployFootprint([], MERGED, { Vercel: "2026-10-25T06:00:00Z", "deploy/expo": "2026-10-25T08:00:00Z" }),
    ).toEqual({ result: "success", at: "2026-10-25T08:00:00Z" });
  });

  it("公開の状態が無く、あとの成功も無い（前・同じ・空）なら何も出さない", () => {
    expect(deployFootprint([], MERGED, { Vercel: MERGED })).toBeNull();
    expect(deployFootprint([], MERGED, { Vercel: "2026-10-25T04:00:00Z" })).toBeNull();
    expect(deployFootprint([], MERGED, {})).toBeNull();
  });

  it("Ignored Build Step の success は main の成功に数えない", () => {
    const mainDeployed = latestSuccessDeployByContext([
      status("Vercel", "success", "2026-10-25T09:00:00Z", "Canceled by Ignored Build Step"),
    ]);
    expect(deployFootprint([], MERGED, mainDeployed)).toBeNull();
    expect(deployFootprint([status("Vercel", "failure")], MERGED, mainDeployed)).toMatchObject({
      result: "failure",
    });
  });

  it("途中（pending）のままなら何も出さない", () => {
    expect(deployFootprint([status("Vercel", "pending")], MERGED, { Vercel: "2026-10-25T07:00:00Z" })).toBeNull();
  });

  it("全部成功なら、マージコミット自身の成功の時刻", () => {
    expect(deployFootprint([status("Vercel", "success")], MERGED, {})).toEqual({
      result: "success",
      at: "2026-10-25T05:03:00Z",
    });
  });
});

describe("出来事：あとの公開で本番に入った物", () => {
  const issue: IssueData = {
    number: 3,
    title: "ホーム",
    body: "",
    state: "closed",
    labels: [],
    url: "https://github.com/o/r/issues/3",
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-25T00:00:00Z",
    closedAt: MERGED,
  };
  const pull: PullData = {
    number: 8,
    title: "PR 8",
    body: "Closes #3",
    state: "closed",
    merged: true,
    labels: [],
    url: "https://github.com/o/r/pull/8",
    headRef: "claude/issue-3-1",
    headSha: "sha8",
    mergeCommitSha: "merge8",
    createdAt: "2026-10-25T01:00:00Z",
    updatedAt: "2026-10-25T01:00:00Z",
    mergedAt: MERGED,
  };

  function build(data: Partial<RepoData>) {
    return buildRecentEvents(
      [
        {
          owner: "o",
          repo: "r",
          ok: true,
          data: { issues: [issue], pulls: [pull], comments: [], pullChecks: {}, events: [], ...data },
        },
      ],
      NOW,
    );
  }

  it("失敗でもあとの公開が成功なら「本番に公開」（あとの公開の時刻）", () => {
    const events = build({
      pullChecks: { 8: { checkRuns: [], statuses: [status("Vercel", "error")] } },
      mainDeployedByContext: { Vercel: "2026-10-25T06:00:00Z" },
    });
    expect(events.find((event) => event.text.includes("公開"))).toMatchObject({
      at: "2026-10-25T06:00:00Z",
      tone: "deployed",
      text: "「ホーム」が本番に公開されました",
    });
    expect(events.filter((event) => event.tone === "fail")).toEqual([]);
  });

  it("公開の状態が無い途中のマージにも、あとの公開の時刻で「本番に公開」", () => {
    const events = build({ mainDeployedByContext: { Vercel: "2026-10-25T06:00:00Z" } });
    expect(events.find((event) => event.text.includes("公開"))).toMatchObject({
      at: "2026-10-25T06:00:00Z",
      tone: "deployed",
    });
  });

  it("あとの公開が無ければ「公開に失敗」", () => {
    const events = build({ pullChecks: { 8: { checkRuns: [], statuses: [status("Vercel", "error")] } } });
    expect(events.find((event) => event.text.includes("公開"))).toMatchObject({ tone: "fail" });
  });
});
