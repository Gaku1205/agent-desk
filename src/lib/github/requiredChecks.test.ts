import { describe, expect, it } from "vitest";
import { missingRequiredChecks, pullsNeedingRequiredChecks, requiredChecksQuery } from "./requiredChecks";
import type { CheckRunData, PullChecks, PullData } from "./types";

function run(name: string, status = "completed"): CheckRunData {
  return { name, status, conclusion: status === "completed" ? "success" : null, appSlug: "github-actions", completedAt: null };
}

function pull(number: number, overrides: Partial<PullData> = {}): PullData {
  return { number, state: "open", merged: false, ...overrides } as PullData;
}

const never = () => false;

describe("pullsNeedingRequiredChecks", () => {
  it("開いていて、終わっていないチェックがある物だけ（チェックが無い PR は調べない）", () => {
    const checks: Record<number, PullChecks> = {
      1: { checkRuns: [run("test", "queued")], statuses: [] },
      2: { checkRuns: [run("test")], statuses: [] },
      4: { checkRuns: [], statuses: [] },
    };
    const pulls = [pull(1), pull(2), pull(3, { merged: true, state: "closed" }), pull(4)];
    expect(pullsNeedingRequiredChecks(pulls, checks, never)).toEqual([1]);
  });

  it("レビューのチェックだけが終わっていなくても数えない", () => {
    const checks: Record<number, PullChecks> = {
      1: { checkRuns: [run("test"), run("review", "in_progress")], statuses: [] },
    };
    expect(pullsNeedingRequiredChecks([pull(1)], checks, (check) => check.name === "review")).toEqual([]);
  });
});

describe("requiredChecksQuery", () => {
  it("PR ごとに別名を付ける", () => {
    const query = requiredChecksQuery([7, 9]);
    expect(query).toContain("p7: pullRequest(number: 7)");
    expect(query).toContain("p9: pullRequest(number: 9)");
    expect(query).toContain("requiredStatusCheckContexts");
  });
});

describe("missingRequiredChecks", () => {
  const response = (required: unknown, p1: unknown = { commits: { nodes: [{ commit: { status: null } }] } }) => ({
    repository: {
      p1: { baseRef: { branchProtectionRule: { requiredStatusCheckContexts: required } }, ...(p1 as object) },
    },
  });

  it("PR ごとの土台のブランチの必須名で突き合わせる（main 以外でも）", () => {
    const checks: Record<number, PullChecks> = {
      1: { checkRuns: [], statuses: [] },
      2: { checkRuns: [], statuses: [] },
    };
    const data = {
      repository: {
        p1: { baseRef: { branchProtectionRule: { requiredStatusCheckContexts: ["a", "b"] } } },
        p2: { baseRef: { branchProtectionRule: null } },
      },
    };
    expect(missingRequiredChecks(data, [1, 2], checks)).toEqual({ 1: 2 });
  });

  it("必須の名前のうち、まだ報告されていない物の数", () => {
    const checks: Record<number, PullChecks> = { 1: { checkRuns: [run("test", "queued")], statuses: [] } };
    expect(missingRequiredChecks(response(["test", "build", "lint"]), [1], checks)).toEqual({ 1: 2 });
  });

  it("コミットステータスで報告された物は数えない", () => {
    const p1 = { commits: { nodes: [{ commit: { status: { contexts: [{ context: "deploy" }] } } }] } };
    const checks: Record<number, PullChecks> = { 1: { checkRuns: [], statuses: [] } };
    expect(missingRequiredChecks(response(["deploy", "build"], p1), [1], checks)).toEqual({ 1: 1 });
  });

  it("全部報告済みなら入れない", () => {
    const checks: Record<number, PullChecks> = { 1: { checkRuns: [run("test"), run("build")], statuses: [] } };
    expect(missingRequiredChecks(response(["test", "build"]), [1], checks)).toEqual({});
  });

  it("ブランチ保護が読めない・無いときは空", () => {
    const checks: Record<number, PullChecks> = { 1: { checkRuns: [], statuses: [] } };
    expect(missingRequiredChecks({ repository: { p1: { baseRef: null } } }, [1], checks)).toEqual({});
    expect(missingRequiredChecks(null, [1], checks)).toEqual({});
  });
});
