import type { CheckRunData, PullChecks, PullData } from "./types";

/**
 * 未報告の必須チェック（docs/spec.md の「Slots & Queue」の「未報告の必須チェック」）。
 * ブランチ保護で必須なのに、まだ一度も報告されていないチェックは、GitHub の画面で `Expected — Waiting for status` になる。
 * このチェックは `statusCheckRollup` に出てこないので、PR の土台のブランチ（baseRef）の保護の必須チェック名と突き合わせて数える
 */

/** 1回の問い合わせで調べる PR の最大数 */
export const REQUIRED_CHECKS_MAX_PULLS = 10;

/**
 * CI の途中（終わっていないチェックがある）の開いている PR の番号。
 * チェックが1つも無い PR は調べない（開いたばかりの PR ごとに呼ぶ回数が増えるため）
 */
export function pullsNeedingRequiredChecks(
  pulls: readonly PullData[],
  pullChecks: Record<number, PullChecks>,
  isReviewCheck: (check: CheckRunData) => boolean,
): number[] {
  const numbers: number[] = [];
  for (const pull of pulls) {
    if (pull.state !== "open" || pull.merged) continue;
    const runs = (pullChecks[pull.number]?.checkRuns ?? []).filter((check) => !isReviewCheck(check));
    if (runs.some((check) => check.status !== "completed")) numbers.push(pull.number);
  }
  return numbers.slice(0, REQUIRED_CHECKS_MAX_PULLS);
}

/** 問い合わせ（各 PR の土台のブランチの保護の必須チェック名と、先頭コミットのコミットステータス） */
export function requiredChecksQuery(numbers: readonly number[]): string {
  const pulls = numbers
    .map(
      (number) =>
        `p${number}: pullRequest(number: ${number}) { baseRef { branchProtectionRule { requiredStatusCheckContexts } } commits(last: 1) { nodes { commit { status { contexts { context } } } } } }`,
    )
    .join("\n    ");
  return `
query RequiredChecks($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ${pulls}
  }
}`;
}

type Raw = Record<string, unknown> | null | undefined;

function asRecord(value: unknown): Raw {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function reportedStatusContexts(pull: unknown): string[] {
  const commits = asRecord(asRecord(pull)?.commits)?.nodes;
  const commit = Array.isArray(commits) ? asRecord(asRecord(commits.at(-1))?.commit) : null;
  const contexts = asRecord(commit?.status)?.contexts;
  if (!Array.isArray(contexts)) return [];
  return contexts.flatMap((item) => {
    const context = asRecord(item)?.context;
    return typeof context === "string" ? [context] : [];
  });
}

/**
 * 返事から、PR ごとの「未報告の必須チェックの数」を決める。
 * 必須の名前のうち、チェックランにも、コミットステータスにも無い物の数。ブランチ保護が読めない・無いときは空
 */
export function missingRequiredChecks(
  data: unknown,
  numbers: readonly number[],
  pullChecks: Record<number, PullChecks>,
): Record<number, number> {
  const repository = asRecord(asRecord(data)?.repository);
  if (!repository) return {};
  const missing: Record<number, number> = {};
  for (const number of numbers) {
    const required = asRecord(asRecord(asRecord(repository[`p${number}`])?.baseRef)?.branchProtectionRule)
      ?.requiredStatusCheckContexts;
    if (!Array.isArray(required)) continue;
    const names = [...new Set(required.filter((name): name is string => typeof name === "string" && name !== ""))];
    const reported = new Set([
      ...(pullChecks[number]?.checkRuns ?? []).map((check) => check.name),
      ...reportedStatusContexts(repository[`p${number}`]),
    ]);
    const count = names.filter((name) => !reported.has(name)).length;
    if (count > 0) missing[number] = count;
  }
  return missing;
}
