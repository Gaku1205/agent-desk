import type {
  CheckRunData,
  CommentData,
  CommitStatusData,
  IssueData,
  IssueEventData,
  PullData,
} from "./types";

/** GitHubのREST APIの応答のうち、使う項目だけの形 */
type GhLabel = string | { name?: string | null };

export type GhIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  labels?: GhLabel[];
  html_url: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  pull_request?: unknown;
};

export type GhPull = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  merged_at?: string | null;
  labels?: GhLabel[];
  html_url: string;
  head: { ref: string; sha: string };
  merge_commit_sha?: string | null;
  created_at: string;
  updated_at: string;
};

export type GhComment = {
  id: number;
  issue_url: string;
  body?: string | null;
  user?: { login: string } | null;
  created_at: string;
};

export type GhCheckRun = {
  name: string;
  status: string;
  conclusion?: string | null;
  app?: { slug?: string | null } | null;
  completed_at?: string | null;
};

export type GhStatus = {
  context: string;
  state: string;
  description?: string | null;
  updated_at: string;
};

export type GhIssueEvent = {
  event: string;
  label?: { name?: string | null } | null;
  issue?: { number: number } | null;
  created_at: string;
};

function labelNames(labels: GhLabel[] | undefined): string[] {
  const names: string[] = [];
  for (const label of labels ?? []) {
    const name = typeof label === "string" ? label : label.name;
    if (name) names.push(name);
  }
  return names;
}

/** Issue一覧にはPRも混ざるので、PRなら null */
export function convertIssue(raw: GhIssue): IssueData | null {
  if (raw.pull_request) return null;
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    labels: labelNames(raw.labels),
    url: raw.html_url,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? null,
  };
}

export function convertPull(raw: GhPull): PullData {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    merged: Boolean(raw.merged_at),
    labels: labelNames(raw.labels),
    url: raw.html_url,
    headRef: raw.head.ref,
    headSha: raw.head.sha,
    mergeCommitSha: raw.merge_commit_sha ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    mergedAt: raw.merged_at ?? null,
  };
}

/** `issue_url`（`.../issues/12`）の末尾から番号を取る。取れなければ null */
function issueNumberFromUrl(url: string): number | null {
  const match = /\/issues\/(\d+)$/.exec(url);
  return match ? Number(match[1]) : null;
}

export function convertComment(raw: GhComment): CommentData | null {
  const issueNumber = issueNumberFromUrl(raw.issue_url);
  if (issueNumber === null) return null;
  return {
    id: raw.id,
    issueNumber,
    author: raw.user?.login ?? "",
    body: raw.body ?? "",
    createdAt: raw.created_at,
  };
}

export function convertCheckRun(raw: GhCheckRun): CheckRunData {
  return {
    name: raw.name,
    status: raw.status,
    conclusion: raw.conclusion ?? null,
    appSlug: raw.app?.slug ?? null,
    completedAt: raw.completed_at ?? null,
  };
}

export function convertStatus(raw: GhStatus): CommitStatusData {
  return {
    context: raw.context,
    state: raw.state,
    description: raw.description ?? "",
    updatedAt: raw.updated_at,
  };
}

export function convertIssueEvent(raw: GhIssueEvent): IssueEventData {
  return {
    event: raw.event,
    labelName: raw.label?.name ?? null,
    issueNumber: raw.issue?.number ?? null,
    createdAt: raw.created_at,
  };
}
