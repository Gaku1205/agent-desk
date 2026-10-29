import type { CheckRunData, IssueData, PullData, RepoData } from "../github/types";
import { findLinkedPull, LABEL } from "../status";
import type { OperationKind } from "../turn";

/**
 * デモで押した「あなたの番」の操作を、サンプルのデータに当てる（docs/spec.md の「デモ」）。
 * GitHub には何も送らない。本物の操作（ラベルを付ける・外す、PRを作る、マージ）に加えて、
 * 本物のパイプラインがすぐにすること（清書に回す・CIが走り出す・公開が始まる）も一緒に真似る
 */

export type DemoOp = {
  owner: string;
  repo: string;
  number: number;
  kind: OperationKind;
  /** 押した時刻（ISO文字列） */
  at: string;
};

const CI_CHECKS = ["typecheck", "lint", "test", "build"];

function runningChecks(): CheckRunData[] {
  return CI_CHECKS.map((name) => ({
    name,
    status: "in_progress",
    conclusion: null,
    appSlug: "github-actions",
    completedAt: null,
  }));
}

function withLabels(labels: string[], add: string[], remove: string[]): string[] {
  return [...labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !labels.includes(l))];
}

/** 1つの操作を当てた、新しいデータ（元のデータは変えない） */
export function applyDemoOp(data: RepoData, op: DemoOp): RepoData {
  const issue = data.issues.find((i) => i.number === op.number);
  if (!issue) return data;
  const pull = findLinkedPull(data.pulls, op.number);
  const next: RepoData = {
    ...data,
    issues: [...data.issues],
    pulls: [...data.pulls],
    comments: [...data.comments],
    pullChecks: { ...data.pullChecks },
    events: [...data.events],
  };
  const setIssue = (patch: Partial<IssueData>) => {
    next.issues = next.issues.map((i) => (i.number === op.number ? { ...i, ...patch, updatedAt: op.at } : i));
  };
  const setPull = (target: PullData, patch: Partial<PullData>) => {
    next.pulls = next.pulls.map((p) => (p.number === target.number ? { ...p, ...patch, updatedAt: op.at } : p));
  };
  const labeled = (issueNumber: number, labelName: string) => {
    next.events.push({ event: "labeled", labelName, issueNumber, createdAt: op.at });
  };

  switch (op.kind) {
    case "plan":
      setIssue({ labels: withLabels(issue.labels, [LABEL.plan], []) });
      labeled(op.number, LABEL.plan);
      break;
    case "implement":
      setIssue({ labels: withLabels(issue.labels, [LABEL.implement], []) });
      labeled(op.number, LABEL.implement);
      break;
    case "start":
      // `ai:skip` を外すと、パイプラインが清書に回す
      setIssue({ labels: withLabels(issue.labels, [LABEL.plan], [LABEL.skip]) });
      labeled(op.number, LABEL.plan);
      break;
    case "resume": {
      setIssue({ labels: withLabels(issue.labels, [], [LABEL.stuck]) });
      if (pull) {
        // 人間が直してpushし、CIをやり直している形にする（修正を確認中）
        setPull(pull, { labels: withLabels(pull.labels, [], [LABEL.stuck]), headSha: `${pull.headSha}r` });
        next.pullChecks[pull.number] = { checkRuns: runningChecks(), statuses: [] };
      }
      break;
    }
    case "createPull": {
      if (pull) break;
      const number = Math.max(0, ...data.issues.map((i) => i.number), ...data.pulls.map((p) => p.number)) + 1;
      next.pulls.push({
        number,
        title: issue.title,
        body: `Closes #${op.number}`,
        state: "open",
        merged: false,
        labels: [],
        url: issue.url,
        headRef: `claude/issue-${op.number}-demo`,
        headSha: `c${op.number}p${number}`,
        mergeCommitSha: null,
        createdAt: op.at,
        updatedAt: op.at,
        mergedAt: null,
      });
      next.pullChecks[number] = { checkRuns: runningChecks(), statuses: [] };
      break;
    }
    case "requestReview":
      if (!pull) break;
      setPull(pull, { labels: withLabels(pull.labels, [LABEL.review], []) });
      labeled(pull.number, LABEL.review);
      break;
    case "merge": {
      if (!pull) break;
      setPull(pull, { state: "closed", merged: true, mergedAt: op.at, mergeCommitSha: `${pull.headSha}ff` });
      setIssue({ state: "closed", closedAt: op.at });
      const checks = next.pullChecks[pull.number] ?? { checkRuns: [], statuses: [] };
      next.pullChecks[pull.number] = {
        ...checks,
        statuses: [...checks.statuses, { context: "Vercel", state: "pending", description: "", updatedAt: op.at }],
      };
      break;
    }
  }
  return next;
}

/** そのリポジトリの操作を、押した順に当てる */
export function applyDemoOps(data: RepoData, ops: DemoOp[], owner: string, repo: string): RepoData {
  return ops.filter((op) => op.owner === owner && op.repo === repo).reduce(applyDemoOp, data);
}
