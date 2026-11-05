import { isAllowedLogin } from "./allowlist";
import { findWatchedRepo, type WatchedRepo } from "./config";
import type { GitHubClient } from "./github/client";
import { GitHubError } from "./github/errors";
import {
  addComment,
  addLabel,
  createIssue,
  createPull,
  fetchIsTemplate,
  findIssueBranch,
  mergePull,
  removeLabel,
} from "./github/operations";
import { composeNewIssue, type NewIssueInput } from "./newIssue";
import { isValidAnswer } from "./question";
import type { RepoData } from "./github/types";
import { isFactoryIssue } from "./factoryIssue";
import { parseFactoryAnswer } from "./factoryTalk";
import { getIssueStatus, LABEL, shouldShowIssue } from "./status";
import { isOperationAvailable, OPERATION_KINDS, type OperationKind } from "./turn";

export type OperationInput = {
  kind: OperationKind;
  owner: string;
  repo: string;
  issueNumber: number;
  /** 「答えを送る」のときだけ：Issueに書くコメントの文 */
  answer?: string;
};

export type OperationResult =
  | { ok: true }
  /** 押した時点で、その操作ができない段階に変わっていた（エラーは出さずに取り直す） */
  | { ok: false; changed: true }
  | { ok: false; changed: false; message: string };

export const OPERATION_MESSAGES = {
  invalid: "操作の内容が正しくありません",
  unauthorized: "ログインし直してください",
  notWatched: "監視していないリポジトリは操作できません",
  noBranch: "PRにするブランチが見つかりません",
  forbidden: "このリポジトリを操作する権限がありません",
  rateLimited: "GitHubのレート制限に達しました。しばらくしてからもう一度試してください",
  failed: "GitHubへの操作に失敗しました",
} as const;

function fail(message: string): OperationResult {
  return { ok: false, changed: false, message };
}

const CHANGED: OperationResult = { ok: false, changed: true };

/** ブラウザから来た値を確かめる（Server Actionは誰でも直接呼べるため） */
export function parseOperationInput(value: unknown): OperationInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, owner, repo, issueNumber, answer } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !(OPERATION_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof owner !== "string" || typeof repo !== "string") return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  if (typeof issueNumber !== "number" || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    return null;
  }
  if (kind === "answer") {
    // 答えの文は空でなく、長すぎない物だけ
    if (!isValidAnswer(answer)) return null;
    return { kind, owner, repo, issueNumber, answer };
  }
  return { kind: kind as OperationKind, owner, repo, issueNumber };
}

export type AuthorizeInput = {
  login: string | null;
  token: string | null;
  allowedLogins: string[];
  watched: WatchedRepo[];
  owner: string;
  repo: string;
};

/** ログイン中かつ許可リストのユーザーで、監視リポジトリのときだけ通す */
export function authorizeOperation(
  input: AuthorizeInput,
): { ok: true; target: WatchedRepo; token: string } | { ok: false; message: string } {
  if (!input.token || !isAllowedLogin(input.login, input.allowedLogins)) {
    return { ok: false, message: OPERATION_MESSAGES.unauthorized };
  }
  const target = findWatchedRepo(input.owner, input.repo, input.watched);
  if (!target) return { ok: false, message: OPERATION_MESSAGES.notWatched };
  return { ok: true, target, token: input.token };
}

/** GitHubのエラーを、画面に出す理由にする */
export function operationErrorMessage(error: unknown): string {
  if (error instanceof GitHubError) {
    if (error.kind === "unauthorized") return OPERATION_MESSAGES.unauthorized;
    if (error.kind === "forbidden" || error.kind === "not_found") return OPERATION_MESSAGES.forbidden;
    if (error.kind === "rate_limited") return OPERATION_MESSAGES.rateLimited;
  }
  return OPERATION_MESSAGES.failed;
}

/**
 * 取り直したデータで今の段階を確かめてから、操作を実行する。
 * その操作ができない段階に変わっていたら何もせず "changed" を返す
 */
export async function executeOperation(
  client: GitHubClient,
  target: WatchedRepo,
  input: OperationInput,
  data: RepoData,
  now: Date,
): Promise<OperationResult> {
  const issue = data.issues.find((i) => i.number === input.issueNumber);
  if (!issue || !shouldShowIssue(issue, data.pulls)) return CHANGED;
  const status = getIssueStatus(issue, data, now);
  if (status.turn !== "human" || !isOperationAvailable(input.kind, status, data)) return CHANGED;
  // 工場が受け持つ「新サービス：」のIssueには、ラベルを付けない
  if (status.stage === "notStarted" && isFactoryIssue(issue.title, data.isTemplate, issue.state)) return CHANGED;
  const pull = status.pull;

  try {
    switch (input.kind) {
      case "plan":
        await addLabel(client, target, issue.number, LABEL.plan);
        break;
      case "implement":
        await addLabel(client, target, issue.number, LABEL.implement);
        break;
      case "resume":
        if (issue.labels.includes(LABEL.stuck)) {
          await removeLabel(client, target, issue.number, LABEL.stuck);
        }
        if (pull?.labels.includes(LABEL.stuck)) {
          await removeLabel(client, target, pull.number, LABEL.stuck);
        }
        break;
      case "start":
        await removeLabel(client, target, issue.number, LABEL.skip);
        break;
      case "createPull": {
        const head = await findIssueBranch(client, target, issue.number);
        if (!head) return fail(OPERATION_MESSAGES.noBranch);
        await createPull(client, target, {
          head,
          title: issue.title,
          body: `Closes #${issue.number}`,
        });
        break;
      }
      case "requestReview":
        if (!pull) return CHANGED;
        await addLabel(client, target, pull.number, LABEL.review);
        break;
      case "answer":
        if (!isValidAnswer(input.answer)) return fail(OPERATION_MESSAGES.invalid);
        // 工場の相談：印があるなら、工場が読める形のときだけ送る
        if (status.stage === "factoryTalk" && parseFactoryAnswer(input.answer) === "invalid") {
          return fail(OPERATION_MESSAGES.invalid);
        }
        // コメントすると、パイプラインが自動で続き（企画）を始める
        await addComment(client, target, issue.number, input.answer);
        break;
      case "merge":
        if (!pull) return CHANGED;
        if ((await mergePull(client, target, pull.number, pull.headSha)) === "changed") {
          return CHANGED;
        }
        break;
    }
  } catch (error) {
    return fail(operationErrorMessage(error));
  }
  return { ok: true };
}

export type CreateIssueResult =
  | { ok: true; number: number; url: string }
  | { ok: false; message: string };

/**
 * 画面から書いたIssueを作る（ラベルは付けない。パイプラインの受付が企画に回す）。
 * テンプレートリポジトリかどうかはサーバーで確かめ直す（画面から来た値は信じない）
 */
export async function executeCreateIssue(
  client: GitHubClient,
  target: WatchedRepo,
  input: NewIssueInput,
): Promise<CreateIssueResult> {
  try {
    const isTemplate = await fetchIsTemplate(client, target);
    const issue = composeNewIssue({ title: input.title, isTemplate, omakase: input.omakase });
    const created = await createIssue(client, target, issue);
    return { ok: true, ...created };
  } catch (error) {
    return { ok: false, message: operationErrorMessage(error) };
  }
}
