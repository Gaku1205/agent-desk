/** 画面とロジックが使う、GitHubのデータの形（GitHubのAPIの形から convert.ts で変換する） */

export type IssueData = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type PullData = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  labels: string[];
  url: string;
  /** ブランチ名（`claude/issue-<番号>-...`） */
  headRef: string;
  /** 先頭コミット */
  headSha: string;
  mergeCommitSha: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
};

/** IssueとPRのコメント（GitHubではPRのコメントもIssueのコメント） */
export type CommentData = {
  id: number;
  /** コメントが付いたIssue／PRの番号 */
  issueNumber: number;
  author: string;
  body: string;
  createdAt: string;
};

export type CheckRunData = {
  name: string;
  status: string;
  conclusion: string | null;
  /** チェックを作ったアプリ（`github-actions` など） */
  appSlug: string | null;
  completedAt: string | null;
};

export type CommitStatusData = {
  context: string;
  state: string;
  /** ステータスの説明（無ければ空文字）。Vercelは失敗の理由をここに書く */
  description: string;
  updatedAt: string;
};

export type IssueEventData = {
  event: string;
  /** `labeled` のときのラベル名 */
  labelName: string | null;
  /** イベントが起きたIssue／PRの番号 */
  issueNumber: number | null;
  createdAt: string;
};

export type PullChecks = {
  /** PRの先頭コミットのチェックラン */
  checkRuns: CheckRunData[];
  /** マージ済みPRのマージコミットのコミットステータス（それ以外は空） */
  statuses: CommitStatusData[];
};

export type RepoData = {
  issues: IssueData[];
  pulls: PullData[];
  comments: CommentData[];
  /** PR番号 → チェックとステータス */
  pullChecks: Record<number, PullChecks>;
  events: IssueEventData[];
};

export type GitHubErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "other";

export type RepoResult =
  | { owner: string; repo: string; ok: true; data: RepoData }
  | {
      owner: string;
      repo: string;
      ok: false;
      error: { kind: GitHubErrorKind; message: string };
    };
