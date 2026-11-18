import { isDeployStatus } from "../deployStatus";
import { isIssueLinkedPull, latestSuccessDeployByContext } from "../status";
import type {
  CheckRunData,
  CommentData,
  CommitStatusData,
  IssueData,
  IssueEventData,
  PullChecks,
  PullData,
} from "./types";

/** Issue と PR で同じ取り方をする所（共通のインターフェースが無いので、文字のまま両方に入れる） */
const COMMENTS = `comments(last: 100) { nodes { databaseId body createdAt updatedAt url author { __typename login } } }`;
const LABEL_EVENTS = `timelineItems(last: 50, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
          nodes {
            __typename
            ... on LabeledEvent { createdAt label { name } }
            ... on UnlabeledEvent { createdAt label { name } }
          }
        }`;

const ISSUE_FIELDS = `number title body state url createdAt updatedAt closedAt
        labels(first: 100) { nodes { name } }
        ${COMMENTS}
        ${LABEL_EVENTS}`;

/**
 * 1ページで取る Issue・PR の数。GraphQL の回数制限（1時間5,000点）は、実際に返った数ではなく、問い合わせに書いた
 * `first` の数で点数が決まる（下の `repoQueryCost`）。100件だと1回の同期が約20点で、12個のリポジトリを
 * Webhook のたびに取り直すと1時間で使い切った（2026年11月18日）。50件にして、足りない分は続きを問い合わせる
 */
export const REPO_PAGE_SIZE = 50;
/** 人間待ちの Issue（ラベルごと）を取る数。ページ送りはしない */
export const WAITING_PAGE_SIZE = 30;

/** 人間の判断を待つラベル。開いている物は、更新日で絞らずに取る（別名は `waiting<番号>`） */
export const WAITING_LABELS = ["ai:stuck", "ai:skip", "ai:question", "factory:wait"] as const;

const waitingAlias = (index: number): string => `waiting${index}`;

/** ラベルの絞り込みは「すべて付いている」なので、ラベルごとの一覧を別名で足す（1回目の問い合わせだけ） */
const WAITING_ISSUES = WAITING_LABELS.map(
  (label, index) => `${waitingAlias(index)}: issues(
      first: ${WAITING_PAGE_SIZE}
      states: OPEN
      labels: ["${label}"]
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) @include(if: $withMain) {
      nodes {
        ${ISSUE_FIELDS}
      }
    }`,
).join("\n    ");

/** main のコミットを見る数（`history(first: …)` と `mainDeployedFrom` の `sample` で共通） */
export const MAIN_COMMITS_SAMPLE = 30;

/**
 * 同期の GraphQL の問い合わせ（docs/spec.md の「データの取得」）。1リポジトリ1回で、
 * Issue・PR・コメント・ラベル・ラベルの付け外し・チェック・公開ステータス・main の公開・回数制限を取る。
 * ページ送りのときは `withIssues`・`withPulls` で続きが要る方だけ、`withMain` は外して問い合わせる
 */
export const REPO_QUERY = `
query RepoData(
  $owner: String!
  $name: String!
  $since: DateTime!
  $issuesAfter: String
  $pullsAfter: String
  $withIssues: Boolean!
  $withPulls: Boolean!
  $withMain: Boolean!
) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    isTemplate
    issues(
      first: ${REPO_PAGE_SIZE}
      after: $issuesAfter
      filterBy: { since: $since }
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) @include(if: $withIssues) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ${ISSUE_FIELDS}
      }
    }
    ${WAITING_ISSUES}
    pullRequests(
      first: ${REPO_PAGE_SIZE}
      after: $pullsAfter
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) @include(if: $withPulls) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body state url createdAt updatedAt mergedAt headRefName headRefOid mergeable
        labels(first: 100) { nodes { name } }
        files(first: 100) { totalCount nodes { path } }
        ${COMMENTS}
        ${LABEL_EVENTS}
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion completedAt checkSuite { app { slug } } }
                  }
                }
              }
            }
          }
        }
        mergeCommit { oid status { ...Statuses } }
      }
    }
    ref(qualifiedName: "refs/heads/main") @include(if: $withMain) {
      target {
        ... on Commit { history(first: ${MAIN_COMMITS_SAMPLE}) { nodes { oid status { ...Statuses } } } }
      }
    }
  }
}
fragment Statuses on Status { contexts { context state description targetUrl createdAt } }
`;

/**
 * 同期の問い合わせ1回の点数の見積もり（GitHub の計算式）。つながり（connection）ごとに、親の数だけ「要求」を数え、
 * 合計を100で割って四捨五入する（最低1点）。返事の `rateLimit.cost` と同じ数え方。
 * - Issue：一覧で1、Issue 1件ごとにラベル・コメント・ラベルの付け外しの3
 * - 人間待ちの Issue：ラベル（4つ）ごとに、一覧で1、Issue 1件ごとに3（1回目の問い合わせ＝`withMain` だけ）
 * - PR：一覧で1、PR 1件ごとにラベル・変更ファイル・コメント・ラベルの付け外し・コミットの5と、先頭コミットのチェックの1
 * - main の直近のコミット：1（1回目の問い合わせだけ）
 */
export function repoQueryCost(parts: { withIssues: boolean; withPulls: boolean; withMain: boolean }): number {
  let requests = 0;
  if (parts.withIssues) requests += 1 + REPO_PAGE_SIZE * 3;
  if (parts.withPulls) requests += 1 + REPO_PAGE_SIZE * 6;
  if (parts.withMain) requests += WAITING_LABELS.length * (1 + WAITING_PAGE_SIZE * 3) + 1;
  return Math.max(1, Math.round(requests / 100));
}

/** GraphQL の返事のうち、使う項目だけの形（どれも欠けうるものとして読む） */
type Nodes<T> = { nodes?: (T | null)[] | null } | null;
type PageInfo = { hasNextPage?: boolean | null; endCursor?: string | null } | null;

export type GqlStatusContext = {
  context?: string | null;
  state?: string | null;
  description?: string | null;
  targetUrl?: string | null;
  createdAt?: string | null;
};

type GqlStatus = { contexts?: (GqlStatusContext | null)[] | null } | null;

export type GqlComment = {
  databaseId?: number | null;
  body?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  url?: string | null;
  author?: { __typename?: string | null; login?: string | null } | null;
};

export type GqlLabelEvent = {
  __typename?: string | null;
  createdAt?: string | null;
  label?: { name?: string | null } | null;
};

export type GqlCheckContext = {
  __typename?: string | null;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  completedAt?: string | null;
  checkSuite?: { app?: { slug?: string | null } | null } | null;
};

export type GqlIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  labels?: Nodes<{ name?: string | null }>;
  comments?: Nodes<GqlComment>;
  timelineItems?: Nodes<GqlLabelEvent>;
};

export type GqlPull = Omit<GqlIssue, "closedAt"> & {
  mergedAt?: string | null;
  headRefName: string;
  headRefOid: string;
  /** main とぶつかっているか（`CONFLICTING` のときだけ `conflicting` になる） */
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
  files?: { totalCount?: number | null; nodes?: ({ path?: string | null } | null)[] | null } | null;
  commits?: Nodes<{
    commit?: { statusCheckRollup?: { contexts?: Nodes<GqlCheckContext> } | null } | null;
  }>;
  mergeCommit?: { oid?: string | null; status?: GqlStatus } | null;
};

type GqlConnection<T> = { pageInfo?: PageInfo; nodes?: (T | null)[] | null } | null;

/** 1回の問い合わせの返事（`data`） */
export type GqlRepoResponse = {
  rateLimit?: unknown;
  repository?: {
    isTemplate?: boolean | null;
    issues?: GqlConnection<GqlIssue>;
    pullRequests?: GqlConnection<GqlPull>;
    [alias: `waiting${number}`]: GqlConnection<GqlIssue> | undefined;
    ref?: {
      target?: { history?: Nodes<{ oid?: string | null; status?: GqlStatus }> } | null;
    } | null;
  } | null;
};

/** 1つの接続（Issue か PR）の、このページの物と、続きのカーソル（無ければ null） */
export type GqlPage<T> = { nodes: T[]; next: string | null };

/** 1回の返事から、使う物を取り出す。`repository` が無ければ null（見つからない） */
export function readRepoResponse(data: unknown): {
  isTemplate: boolean | undefined;
  issues: GqlPage<GqlIssue> | null;
  pulls: GqlPage<GqlPull> | null;
  /** 人間待ちのラベルが付いた、開いている Issue（4つの一覧を合わせた物。1回目の返事だけ） */
  waiting: GqlIssue[];
  mainCommits: CommitStatusData[][] | null;
} | null {
  const repository = (data as GqlRepoResponse | null)?.repository;
  if (!repository) return null;
  const page = <T>(connection: GqlConnection<T> | undefined): GqlPage<T> | null => {
    if (!connection) return null;
    const nodes = (connection.nodes ?? []).filter((node): node is T => node !== null);
    const info = connection.pageInfo;
    const next = info?.hasNextPage && typeof info.endCursor === "string" ? info.endCursor : null;
    return { nodes, next };
  };
  const history = repository.ref?.target?.history;
  return {
    isTemplate: typeof repository.isTemplate === "boolean" ? repository.isTemplate : undefined,
    issues: page(repository.issues),
    pulls: page(repository.pullRequests),
    waiting: WAITING_LABELS.flatMap((_, index) => page(repository[waitingAlias(index) as `waiting${number}`])?.nodes ?? []),
    mainCommits: history
      ? (history.nodes ?? []).map((commit) => convertStatuses(commit?.status ?? null))
      : null,
  };
}

function nodesOf<T>(connection: Nodes<T> | undefined): T[] {
  return (connection?.nodes ?? []).filter((node): node is T => node !== null);
}

function lower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function labelNames(labels: GqlIssue["labels"]): string[] {
  const names: string[] = [];
  for (const label of nodesOf(labels)) if (label.name) names.push(label.name);
  return names;
}

export function convertGqlIssue(raw: GqlIssue): IssueData {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state === "CLOSED" ? "closed" : "open",
    labels: labelNames(raw.labels),
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    closedAt: raw.closedAt ?? null,
  };
}

/** PRの `MERGED`・`CLOSED` は `closed`。マージコミットはマージ済みのときだけ持つ */
export function convertGqlPull(raw: GqlPull): PullData {
  const merged = Boolean(raw.mergedAt);
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state === "OPEN" ? "open" : "closed",
    merged,
    labels: labelNames(raw.labels),
    url: raw.url,
    headRef: raw.headRefName,
    headSha: raw.headRefOid,
    mergeCommitSha: merged ? (raw.mergeCommit?.oid ?? null) : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    mergedAt: raw.mergedAt ?? null,
    ...(raw.mergeable === "CONFLICTING" ? { conflicting: true } : {}),
    ...convertGqlFiles(raw),
  };
}

/** 変更ファイルの名前。取れなかった・100件を超えるときは持たない（重なり無しの扱い） */
function convertGqlFiles(raw: GqlPull): { files?: string[] } {
  const files = raw.files;
  if (!files || !Array.isArray(files.nodes)) return {};
  if (typeof files.totalCount === "number" && files.totalCount > files.nodes.length) return {};
  const paths = files.nodes.flatMap((node) => (typeof node?.path === "string" ? [node.path] : []));
  return { files: paths };
}

/** Issue・PRのコメント。Bot のログイン名は REST と同じく `[bot]` を付ける。読めない物は捨てる */
export function convertGqlComments(issueNumber: number, raw: GqlIssue): CommentData[] {
  const comments: CommentData[] = [];
  for (const comment of nodesOf(raw.comments)) {
    if (typeof comment.databaseId !== "number" || typeof comment.createdAt !== "string") continue;
    const login = comment.author?.login ?? "";
    const author = login && comment.author?.__typename === "Bot" ? `${login}[bot]` : login;
    comments.push({
      id: comment.databaseId,
      issueNumber,
      author,
      body: comment.body ?? "",
      createdAt: comment.createdAt,
      // 「AIが今していること」に使う（無ければ付けない）
      ...(typeof comment.updatedAt === "string" ? { updatedAt: comment.updatedAt } : {}),
      ...(typeof comment.url === "string" ? { url: comment.url } : {}),
    });
  }
  return comments;
}

/** ラベルの付け外し（`LabeledEvent`・`UnlabeledEvent`）を、REST の `issues/events` と同じ形にする */
export function convertGqlLabelEvents(issueNumber: number, raw: GqlIssue): IssueEventData[] {
  const events: IssueEventData[] = [];
  for (const item of nodesOf(raw.timelineItems)) {
    const event =
      item.__typename === "LabeledEvent"
        ? "labeled"
        : item.__typename === "UnlabeledEvent"
          ? "unlabeled"
          : null;
    if (event === null || typeof item.createdAt !== "string") continue;
    events.push({ event, labelName: item.label?.name ?? null, issueNumber, createdAt: item.createdAt });
  }
  return events;
}

/** 先頭コミットのチェックのうち、チェックラン（`CheckRun`）だけ */
export function convertGqlCheckRuns(raw: GqlPull): CheckRunData[] {
  const head = nodesOf(raw.commits).at(-1);
  const contexts = nodesOf(head?.commit?.statusCheckRollup?.contexts);
  const runs: CheckRunData[] = [];
  for (const context of contexts) {
    if (context.__typename !== "CheckRun" || typeof context.name !== "string") continue;
    runs.push({
      name: context.name,
      status: lower(context.status),
      conclusion: context.conclusion ? lower(context.conclusion) : null,
      appSlug: context.checkSuite?.app?.slug ?? null,
      completedAt: context.completedAt ?? null,
    });
  }
  return runs;
}

/** コミットステータス（context ごとの最新）。時刻は `createdAt`（REST の combined status の `updated_at` と同じ） */
export function convertStatuses(status: GqlStatus): CommitStatusData[] {
  const statuses: CommitStatusData[] = [];
  for (const context of status?.contexts ?? []) {
    if (!context || typeof context.context !== "string" || typeof context.createdAt !== "string") {
      continue;
    }
    statuses.push({
      context: context.context,
      state: lower(context.state),
      description: context.description ?? "",
      updatedAt: context.createdAt,
      ...(typeof context.targetUrl === "string" ? { targetUrl: context.targetUrl } : {}),
    });
  }
  return statuses;
}

/**
 * PRのチェック。開いているPR（Issueに紐づかないPRも）：先頭コミットのチェックランだけ（「マージしてよいPR」の CI の判定に要る）。
 * マージ済み：先頭コミットのチェックラン（出来事のCI・レビューの足あと用）とマージコミットの公開ステータス。閉じた（未マージ）PRと、マージ済みのIssueに紐づかないPRは持たない（null）
 */
export function convertGqlPullChecks(raw: GqlPull, pull: PullData): PullChecks | null {
  if (pull.state === "closed" && !pull.merged) return null;
  if (!pull.merged) return { checkRuns: convertGqlCheckRuns(raw), statuses: [] };
  if (!isIssueLinkedPull(pull)) return null;
  return { checkRuns: convertGqlCheckRuns(raw), statuses: convertStatuses(raw.mergeCommit?.status ?? null) };
}

/** main の最後の公開の成功：全体のいちばん新しい時刻と、context ごとの時刻 */
export type MainDeployed = { at: string | null; byContext: Record<string, string> };

/**
 * main の直近のコミット（新しい順）の公開ステータスから、context ごとに最後に公開が成功した時刻を決める。
 * 見えた公開の context が全部見つかった時点でやめる（docs/spec.md の「main の最後に公開が成功した時刻」）
 */
export function mainDeployedFrom(commits: CommitStatusData[][], sample = MAIN_COMMITS_SAMPLE): MainDeployed {
  const byContext: Record<string, string> = {};
  const seen = new Set<string>();
  for (const statuses of commits.slice(0, sample)) {
    for (const s of statuses) if (isDeployStatus(s.context)) seen.add(s.context);
    // 新しいコミットで見つかった context は、古いコミットの値で上書きしない
    for (const [context, at] of Object.entries(latestSuccessDeployByContext(statuses))) {
      byContext[context] ??= at;
    }
    if (seen.size > 0 && [...seen].every((context) => context in byContext)) break;
  }
  return { at: Object.values(byContext).sort().at(-1) ?? null, byContext };
}

/** 前回見つけた成功と今回の結果を、context ごとに新しい方で合わせる。`at` は合わせた byContext の最新 */
export function mergeMainDeployed(previous: MainDeployed | undefined, found: MainDeployed): MainDeployed {
  const byContext: Record<string, string> = { ...(previous?.byContext ?? {}) };
  for (const [context, at] of Object.entries(found.byContext)) {
    const old = byContext[context];
    if (old === undefined || old < at) byContext[context] = at;
  }
  return { at: Object.values(byContext).sort().at(-1) ?? null, byContext };
}

/** 人間の判断を待つ、開いている Issue か（更新日で絞らない物） */
function isWaitingIssue(issue: IssueData): boolean {
  return issue.state === "open" && issue.labels.some((label) => (WAITING_LABELS as readonly string[]).includes(label));
}

/**
 * 取った Issue・PR のノードを今の型にして、直近14日（`cutoffMs` 以降）に絞る。
 * 人間待ちの Issue（`waitingNodes`、または人間待ちのラベルが付いた開いている Issue）は絞らない
 * （コメント・ラベルの付け外しも同じ）。同じ番号は1件にする
 */
export function convertRepoNodes(
  issueNodes: GqlIssue[],
  pullNodes: GqlPull[],
  cutoffMs: number,
  waitingNodes: GqlIssue[] = [],
): {
  issues: IssueData[];
  pulls: PullData[];
  comments: CommentData[];
  pullChecks: Record<number, PullChecks>;
  events: IssueEventData[];
} {
  const issues: IssueData[] = [];
  const pulls: PullData[] = [];
  const comments: CommentData[] = [];
  const pullChecks: Record<number, PullChecks> = {};
  const events: IssueEventData[] = [];
  const seen = new Set<number>();
  const waitingNumbers = new Set<number>();
  for (const raw of [...issueNodes, ...waitingNodes]) {
    const issue = convertGqlIssue(raw);
    if (seen.has(issue.number)) continue;
    const waiting = isWaitingIssue(issue);
    if (!waiting && Date.parse(issue.updatedAt) < cutoffMs) continue;
    seen.add(issue.number);
    if (waiting) waitingNumbers.add(issue.number);
    issues.push(issue);
    comments.push(...convertGqlComments(issue.number, raw));
    events.push(...convertGqlLabelEvents(issue.number, raw));
  }
  for (const raw of pullNodes) {
    const pull = convertGqlPull(raw);
    if (Date.parse(pull.updatedAt) < cutoffMs) continue;
    pulls.push(pull);
    comments.push(...convertGqlComments(pull.number, raw));
    events.push(...convertGqlLabelEvents(pull.number, raw));
    const checks = convertGqlPullChecks(raw, pull);
    if (checks) pullChecks[pull.number] = checks;
  }
  return {
    issues,
    pulls,
    comments: comments
      .filter(
        (comment) => Date.parse(comment.createdAt) >= cutoffMs || waitingNumbers.has(comment.issueNumber),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    pullChecks,
    events: events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
