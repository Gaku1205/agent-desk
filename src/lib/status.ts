import type { CheckRunData, CommentData, CommitStatusData, IssueData, PullChecks, PullData } from "./github/types";

/** 各Issueの段階（docs/spec.md の「状態の判定」） */
export type Stage =
  | "stuck"
  | "deployed"
  | "deploying"
  | "deployFailed"
  | "fixing"
  | "reviewing"
  | "mergeWaiting"
  | "ciRunning"
  | "ciFailed"
  | "prWaiting"
  | "implementing"
  | "planning"
  | "queued"
  | "notStarted";

/** 誰の番か */
export type Turn = "human" | "ai" | "none";

/** マージ待ちの「誰の番」の3通り */
export type MergeWait =
  /** `ai:hold` がある：人間がマージを押す */
  | "hold"
  /** レビューが「指摘なし」で終わっていない：パイプラインがレビューに回すか、直させる */
  | "needsReview"
  /** CIもレビューもOK：パイプラインが自動でマージする直前 */
  | "autoMerge";

export type IssueStatus = {
  stage: Stage;
  turn: Turn;
  /** 止まったときの「止まる前の段階」（止まっていなければ null） */
  stageBeforeStuck: Exclude<Stage, "stuck"> | null;
  /** 紐づくPR（無ければ null） */
  pull: PullData | null;
  /** CIのチェック（Claude Reviewを除く）の通過数と全数 */
  ci: { passed: number; total: number };
  /** マージ待ちのときだけ */
  mergeWait: MergeWait | null;
  /** 実装AIがエラーで止まった（PR作成待ちのとき） */
  implementError: boolean;
  /** 公開ステータスが無いまま30分たって「公開済み」にしたとき */
  deployUnknown: boolean;
  /** 止まった理由（止まったときだけ） */
  stuckReason: string | null;
  /** 企画AIが清書した（Issue本文に `> 元のメモ：` がある） */
  planned: boolean;
  /** 自動の修正依頼の数（0〜2） */
  fixCount: number;
  /** 直したあとの、CIかレビューの確認中 */
  verifyingFix: boolean;
};

export type StatusInput = {
  pulls: PullData[];
  comments: CommentData[];
  pullChecks: Record<number, PullChecks>;
};

export const LABEL = {
  plan: "ai:plan",
  implement: "ai:implement",
  review: "ai:review",
  queue: "ai:queue",
  hold: "ai:hold",
  stuck: "ai:stuck",
} as const;

const CLAUDE_BOT = "claude[bot]";
const GITHUB_ACTIONS_APP = "github-actions";
/** 公開ステータスが無いまま、これだけたったら「公開済み（状況は不明）」にする */
export const DEPLOY_UNKNOWN_AFTER_MS = 30 * 60 * 1000;
/** パイプラインの修正依頼コメントの印と、依頼時の先頭コミット（scripts/pipeline-lib.sh） */
const AUTO_FIX_MARK = "<!-- auto-fix -->";
const AUTO_FIX_SHA_PATTERN = /<!--\s*auto-fix-sha:\s*([0-9a-f]+)\s*-->/;
/** 自動で直す回数の上限 */
export const MAX_AUTO_FIX = 2;
/** 清書したIssueの本文にある印 */
const PLAN_MEMO_MARK = "> 元のメモ：";
const STUCK_PREFIX ="⏸ 自動で進めるのを止めました：";
export const DEFAULT_STUCK_REASON = "自動で進められず止まりました";
/** 「通過」とみなすチェックの結果 */
const PASSED_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/** 段階ごとの誰の番（マージ待ちは mergeWait で変わる） */
const TURN_BY_STAGE: Record<Stage, Turn> = {
  stuck: "human",
  deployed: "none",
  deploying: "none",
  deployFailed: "human",
  fixing: "ai",
  reviewing: "ai",
  mergeWaiting: "ai",
  ciRunning: "ai",
  ciFailed: "ai",
  prWaiting: "human",
  implementing: "ai",
  planning: "ai",
  queued: "none",
  notStarted: "human",
};

/** PRの本文に `Closes #<番号>`（Fixes/Resolvesも可、大文字小文字は問わない）があるか */
export function bodyClosesIssue(body: string, issueNumber: number): boolean {
  const pattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;
  for (const match of body.matchAll(pattern)) {
    if (Number(match[1]) === issueNumber) return true;
  }
  return false;
}

/** 本文の `Closes #<番号>` か、ブランチ名 `claude/issue-<番号>-` でIssueに紐づくか */
export function isLinkedPull(pull: PullData, issueNumber: number): boolean {
  return (
    bodyClosesIssue(pull.body, issueNumber) || pull.headRef.startsWith(`claude/issue-${issueNumber}-`)
  );
}

/**
 * 紐づくPRを1つ選ぶ。openのものを優先し、無ければマージ済みのもの（それぞれ新しい順）。
 * マージされずに閉じたPRは使わない
 */
export function findLinkedPull(pulls: PullData[], issueNumber: number): PullData | null {
  const linked = pulls.filter((pull) => isLinkedPull(pull, issueNumber));
  const newest = (list: PullData[], key: (pull: PullData) => string) =>
    [...list].sort((a, b) => key(b).localeCompare(key(a)))[0] ?? null;
  return (
    newest(
      linked.filter((pull) => pull.state === "open"),
      (pull) => pull.createdAt,
    ) ??
    newest(
      linked.filter((pull) => pull.merged),
      (pull) => pull.mergedAt ?? pull.createdAt,
    )
  );
}

/** 表示するIssueか：openなら表示。閉じたIssueは紐づくPRがマージ済みのときだけ */
export function shouldShowIssue(issue: IssueData, pulls: PullData[]): boolean {
  if (issue.state === "open") return true;
  return pulls.some((pull) => pull.merged && isLinkedPull(pull, issue.number));
}

function byCreatedAt(a: CommentData, b: CommentData): number {
  return a.createdAt.localeCompare(b.createdAt);
}

/** 実装AIの完了コメント：`claude[bot]` のコメントで `Claude finished` を含む */
export function isImplementDoneComment(comment: CommentData): boolean {
  return comment.author === CLAUDE_BOT && comment.body.includes("Claude finished");
}

/** 実装AIのエラーコメント：`claude[bot]` のコメントで `Claude encountered an error` を含む */
export function isImplementErrorComment(comment: CommentData): boolean {
  return comment.author === CLAUDE_BOT && comment.body.includes("Claude encountered an error");
}

/** 実装AIの最後の結果（完了／エラー／まだ無い） */
export function implementResult(
  comments: CommentData[],
  issueNumber: number,
): "done" | "error" | null {
  const last = comments
    .filter(
      (comment) =>
        comment.issueNumber === issueNumber &&
        (isImplementDoneComment(comment) || isImplementErrorComment(comment)),
    )
    .sort(byCreatedAt)
    .at(-1);
  if (!last) return null;
  return isImplementDoneComment(last) ? "done" : "error";
}

/** Claude Reviewのチェック（`claude-review.yml` のジョブ `review`） */
export function isClaudeReviewCheck(check: CheckRunData): boolean {
  if (check.appSlug !== GITHUB_ACTIONS_APP) return false;
  const name = check.name.toLowerCase();
  return name === "review" || name.includes("claude review") || name.includes("claude-review");
}

/** Claude Reviewのチェックが `skipped` 以外の結果で完了したか */
export function hasFinishedReviewCheck(checkRuns: CheckRunData[]): boolean {
  return checkRuns.some(
    (check) =>
      isClaudeReviewCheck(check) &&
      check.status === "completed" &&
      check.conclusion !== null &&
      check.conclusion !== "skipped",
  );
}

export type CiState = {
  state: "running" | "failed" | "passed";
  passed: number;
  total: number;
};

/**
 * CIのチェック（Claude Review以外）の状態。Vercelのチェックも数に入れるが、
 * GitHub ActionsのCIチェックが1つも無いうちは「通った」とみなさない
 */
export function ciState(checkRuns: CheckRunData[]): CiState {
  const checks = checkRuns.filter((check) => !isClaudeReviewCheck(check));
  const completed = checks.filter((check) => check.status === "completed");
  const passed = completed.filter(
    (check) => check.conclusion !== null && PASSED_CONCLUSIONS.has(check.conclusion),
  ).length;
  const total = checks.length;
  const failed = completed.length > passed;
  const hasActionsCheck = checks.some((check) => check.appSlug === GITHUB_ACTIONS_APP);
  if (failed) return { state: "failed", passed, total };
  if (!hasActionsCheck || completed.length < total) return { state: "running", passed, total };
  return { state: "passed", passed, total };
}

/** レビューが「指摘なし」で終わったか：`claude[bot]` の「## Code review」で始まる最新のコメントに `No issues found` */
export function reviewedWithoutIssues(comments: CommentData[], pullNumber: number): boolean {
  const last = comments
    .filter(
      (comment) =>
        comment.issueNumber === pullNumber &&
        comment.author === CLAUDE_BOT &&
        comment.body.trimStart().startsWith("## Code review"),
    )
    .sort(byCreatedAt)
    .at(-1);
  return last !== undefined && last.body.includes("No issues found");
}

/** パイプラインがPRに書いた最新の「⏸ 自動で進めるのを止めました：{理由}」の理由 */
export function stuckReason(comments: CommentData[], pullNumber: number | null): string | null {
  if (pullNumber === null) return null;
  const last = comments
    .filter((comment) => comment.issueNumber === pullNumber && comment.body.includes(STUCK_PREFIX))
    .sort(byCreatedAt)
    .at(-1);
  if (!last) return null;
  const after = last.body.slice(last.body.indexOf(STUCK_PREFIX) + STUCK_PREFIX.length);
  const reason = after.split("\n")[0].trim();
  return reason === "" ? null : reason;
}

/** 清書したか：Issue本文に `> 元のメモ：` がある */
export function isPlanned(issue: IssueData): boolean {
  return issue.body.includes(PLAN_MEMO_MARK);
}

/** PRにある修正依頼コメント（`<!-- auto-fix -->` を含む）の、依頼時の先頭コミット（古い順） */
export function autoFixRequestShas(comments: CommentData[], pullNumber: number): (string | null)[] {
  return comments
    .filter((comment) => comment.issueNumber === pullNumber && comment.body.includes(AUTO_FIX_MARK))
    .sort(byCreatedAt)
    .map((comment) => AUTO_FIX_SHA_PATTERN.exec(comment.body)?.[1] ?? null);
}

/** 修正中か：最新の修正依頼のSHAが、PRの先頭コミットのまま（まだ直したコミットが来ていない） */
export function isFixing(comments: CommentData[], pull: PullData): boolean {
  const last = autoFixRequestShas(comments, pull.number).at(-1);
  return last !== undefined && last !== null && last === pull.headSha;
}

/** 修正した回数：修正依頼コメントの数（上限まで） */
export function fixCount(comments: CommentData[], pull: PullData): number {
  return Math.min(autoFixRequestShas(comments, pull.number).length, MAX_AUTO_FIX);
}

/** 直したコミットがpush済みか：最新の修正依頼のSHAと、PRの先頭コミットが違う */
export function hasPushedFix(comments: CommentData[], pull: PullData): boolean {
  const last = autoFixRequestShas(comments, pull.number).at(-1);
  return last !== undefined && last !== null && last !== pull.headSha;
}

export type DeployState ={ state: "deployed" | "deploying" | "failed"; unknown: boolean };

/**
 * 公開ステータス（context が `Vercel` で始まるコミットステータス）の解決。
 * 無いときは、マージから30分たっていれば「公開済み（状況は不明）」、それまでは「公開中」
 */
export function deployState(
  statuses: CommitStatusData[],
  mergedAt: string | null,
  now: Date,
): DeployState {
  const latest = statuses
    .filter((status) => status.context.startsWith("Vercel"))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
  if (latest) {
    if (latest.state === "success") return { state: "deployed", unknown: false };
    if (latest.state === "failure" || latest.state === "error") return { state: "failed", unknown: false };
    return { state: "deploying", unknown: false };
  }
  const merged = mergedAt ? Date.parse(mergedAt) : NaN;
  if (!Number.isNaN(merged) && now.getTime() - merged >= DEPLOY_UNKNOWN_AFTER_MS) {
    return { state: "deployed", unknown: true };
  }
  return { state: "deploying", unknown: false };
}

type BaseStatus = Omit<IssueStatus, "stage" | "stageBeforeStuck" | "stuckReason"> & {
  stage: Exclude<Stage, "stuck">;
};

/** `ai:stuck` を見ないで、表の残りで段階を決める */
function baseStatus(issue: IssueData, input: StatusInput, now: Date): BaseStatus {
  const pull = findLinkedPull(input.pulls, issue.number);
  const checks = pull ? (input.pullChecks[pull.number] ?? { checkRuns: [], statuses: [] }) : null;
  const ci = checks ? ciState(checks.checkRuns) : { state: "running" as const, passed: 0, total: 0 };
  const fixes = pull ? fixCount(input.comments, pull) : 0;
  const pushedFix = pull ? hasPushedFix(input.comments, pull) : false;
  const result = (
    stage: Exclude<Stage, "stuck">,
    extra: Partial<BaseStatus> = {},
  ): BaseStatus => ({
    stage,
    turn: TURN_BY_STAGE[stage],
    pull,
    ci: { passed: ci.passed, total: ci.total },
    mergeWait: null,
    implementError: false,
    deployUnknown: false,
    planned: isPlanned(issue),
    fixCount: fixes,
    verifyingFix:
      pushedFix && (stage === "reviewing" || stage === "ciRunning" || stage === "ciFailed"),
    ...extra,
  });

  if (pull && checks && pull.merged) {
    const deploy = deployState(checks.statuses, pull.mergedAt, now);
    if (deploy.state === "deployed") return result("deployed", { deployUnknown: deploy.unknown });
    if (deploy.state === "failed") return result("deployFailed");
    return result("deploying");
  }

  if (pull && checks) {
    if (isFixing(input.comments, pull)) return result("fixing");
    if (pull.labels.includes(LABEL.review) && !hasFinishedReviewCheck(checks.checkRuns)) {
      return result("reviewing");
    }
    if (ci.state === "passed") {
      const mergeWait: MergeWait = pull.labels.includes(LABEL.hold)
        ? "hold"
        : reviewedWithoutIssues(input.comments, pull.number)
          ? "autoMerge"
          : "needsReview";
      return result("mergeWaiting", { turn: mergeWait === "hold" ? "human" : "ai", mergeWait });
    }
    return result(ci.state === "failed" ? "ciFailed" : "ciRunning");
  }

  const implement = implementResult(input.comments, issue.number);
  if (implement) return result("prWaiting", { implementError: implement === "error" });
  if (issue.labels.includes(LABEL.implement)) return result("implementing");
  if (issue.labels.includes(LABEL.plan)) return result("planning");
  if (issue.labels.includes(LABEL.queue)) return result("queued");
  return result("notStarted");
}

/** Issueの段階と誰の番を決める（docs/spec.md の表を上から順に評価） */
export function getIssueStatus(issue: IssueData, input: StatusInput, now: Date): IssueStatus {
  const base = baseStatus(issue, input, now);
  const stuck =
    issue.state === "open" &&
    (issue.labels.includes(LABEL.stuck) || (base.pull?.labels.includes(LABEL.stuck) ?? false));
  if (!stuck) return { ...base, stageBeforeStuck: null, stuckReason: null };
  return {
    ...base,
    stage: "stuck",
    turn: "human",
    stageBeforeStuck: base.stage,
    stuckReason: stuckReason(input.comments, base.pull?.number ?? null) ?? DEFAULT_STUCK_REASON,
  };
}
