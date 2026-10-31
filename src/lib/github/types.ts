import type { PipelineState } from "../pipelineState";
import type { WatchdogLastRun } from "../watchdogState";

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
  /** ステータスのリンク先（無ければ無し）。公開が success なら公開先、failure・error ならActionsの実行のページ */
  targetUrl?: string;
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
  /** main の直近のコミットのうち、公開が成功したいちばん新しい物の時刻（無ければ null。調べていなければ無し） */
  mainDeployedAt?: string | null;
  /** context ごとの、main の最後に公開が成功した時刻。無ければ（テストなど）`mainDeployedAt` をどの context にも使う */
  mainDeployedByContext?: Record<string, string>;
  /** パイプラインが動いているか。調べていなければ（テストなど）無し＝分からない */
  pipeline?: PipelineState;
  /** テンプレートリポジトリか（GitHub の `is_template`）。調べられなければ無し＝分からない */
  isTemplate?: boolean;
  /** 見張り役（watchdog.yml）の最後の実行。調べていなければ無し＝分からない */
  watchdog?: WatchdogLastRun;
};

export type GitHubErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "other";

/** 同期の読み取りに使った鍵。`app` はキャッシュに覚え、Webhook で取り直す（無ければ `user` と同じ扱い） */
export type ReadSource = "app" | "user";

export type RepoResult =
  | {
      owner: string;
      repo: string;
      ok: true;
      data: RepoData;
      readSource?: ReadSource;
      /** App の鍵で読んでキャッシュを通したとき、このデータに反映済みの「変わった」印（ISO 文字列） */
      changeMark?: string;
    }
  | {
      owner: string;
      repo: string;
      ok: false;
      error: { kind: GitHubErrorKind; message: string };
      readSource?: ReadSource;
    };
