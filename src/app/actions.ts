"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_EXPIRED_PATH } from "@/lib/authExpired";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { getAllowedLogins, getSettingsRepo } from "@/lib/config";
import { requestAutoAddCheck } from "@/lib/github/autoAdd";
import { GitHubClient } from "@/lib/github/client";
import { fetchRepoData } from "@/lib/github/fetch";
import { invalidateRepoNow } from "@/lib/github/repoCache";
import { fetchStepLogBody } from "@/lib/github/stepLog";
import { parseStepLog, type StepInfo } from "@/lib/stepLog";
import {
  authorizeOperation,
  executeCreateIssue,
  executeOperation,
  executeUploadIssueImage,
  OPERATION_MESSAGES,
  operationErrorMessage,
  parseOperationInput,
  type CreateIssueResult,
  type OperationResult,
  type UploadImageResult,
} from "@/lib/operations";
import { IMAGE_FORM_FIELDS, MAX_ISSUE_IMAGE_BYTES, parseImageBytes } from "@/lib/issueImages";
import { parseNewIssueInput } from "@/lib/newIssue";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/** 「あなたの番」のボタンの操作。トークンはサーバー側だけで使い、結果には含めない */
export async function runOperation(value: unknown): Promise<OperationResult> {
  const input = parseOperationInput(value);
  if (!input) return { ok: false, changed: false, message: OPERATION_MESSAGES.invalid };

  const auth = authorizeOperation({
    login: await getSignedInLogin(),
    token: await getGitHubToken(),
    allowedLogins: getAllowedLogins(),
    watched: (await loadWatchedRepos()).repos,
    owner: input.owner,
    repo: input.repo,
  });
  if (!auth.ok) return { ok: false, changed: false, message: auth.message };

  const client = new GitHubClient(auth.token);
  const now = new Date();
  let result: OperationResult;
  try {
    const data = await fetchRepoData(client, auth.target, now);
    result = await executeOperation(client, auth.target, input, data, now);
  } catch (error) {
    const message = operationErrorMessage(error);
    if (message === OPERATION_MESSAGES.unauthorized) redirect(SESSION_EXPIRED_PATH);
    return { ok: false, changed: false, message };
  }
  // 操作の途中で 401 になったときも、ログアウトしてログインの画面へ
  if (!result.ok && !result.changed && result.message === OPERATION_MESSAGES.unauthorized) {
    redirect(SESSION_EXPIRED_PATH);
  }
  if (result.ok || result.changed) {
    // 押した結果をすぐ出すため、Webhook を待たずにキャッシュを無効にする
    invalidateRepoNow(auth.target);
    refresh();
  }
  return result;
}

/** 画面から書くIssue。ログイン中で許可リストのユーザー、監視リポジトリだけ。ラベルは付けない */
export async function createNewIssue(value: unknown): Promise<CreateIssueResult> {
  const input = parseNewIssueInput(value);
  if (!input) return { ok: false, message: OPERATION_MESSAGES.invalid };

  const auth = authorizeOperation({
    login: await getSignedInLogin(),
    token: await getGitHubToken(),
    allowedLogins: getAllowedLogins(),
    watched: (await loadWatchedRepos()).repos,
    owner: input.owner,
    repo: input.repo,
  });
  if (!auth.ok) return { ok: false, message: auth.message };

  const result = await executeCreateIssue(new GitHubClient(auth.token), auth.target, input);
  if (!result.ok && result.message === OPERATION_MESSAGES.unauthorized) redirect(SESSION_EXPIRED_PATH);
  if (result.ok) {
    // できたIssueをすぐ出すため、Webhook を待たずにキャッシュを無効にする
    invalidateRepoNow(auth.target);
    refresh();
  }
  return result;
}

/**
 * Issueに付ける画像を1枚、専用ブランチ `issue-images` に上げる（`createNewIssue` の前に1枚ずつ呼ぶ）。
 * 画像は base64 にせず FormData のファイルのまま受ける（Vercel の関数は1回の本文が4.5MBまでのため）。
 * 認可は `createNewIssue` と同じ。種類・大きさはサーバーで確かめ直す
 */
export async function uploadNewIssueImage(formData: FormData): Promise<UploadImageResult> {
  if (!(formData instanceof FormData)) return { ok: false, message: OPERATION_MESSAGES.invalid };
  const owner = formData.get(IMAGE_FORM_FIELDS.owner);
  const repo = formData.get(IMAGE_FORM_FIELDS.repo);
  const file = formData.get(IMAGE_FORM_FIELDS.file);
  if (typeof owner !== "string" || typeof repo !== "string" || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    return { ok: false, message: OPERATION_MESSAGES.invalid };
  }
  // 中身を読む前に、大きさで断る
  if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_ISSUE_IMAGE_BYTES) {
    return { ok: false, message: OPERATION_MESSAGES.invalid };
  }

  const auth = authorizeOperation({
    login: await getSignedInLogin(),
    token: await getGitHubToken(),
    allowedLogins: getAllowedLogins(),
    watched: (await loadWatchedRepos()).repos,
    owner,
    repo,
  });
  if (!auth.ok) return { ok: false, message: auth.message };

  const image = parseImageBytes(new Uint8Array(await file.arrayBuffer()));
  if (!image) return { ok: false, message: OPERATION_MESSAGES.invalid };

  const result = await executeUploadIssueImage(new GitHubClient(auth.token), auth.target, image, new Date());
  if (!result.ok && result.message === OPERATION_MESSAGES.unauthorized) redirect(SESSION_EXPIRED_PATH);
  return result;
}

/**
 * 進捗図の「モデル名と所要時間」。Issue の進捗ログのコメントを読む。
 * ログイン中で許可リストのユーザー、監視リポジトリだけ。取れなかったとき・記録が無いときは空（記録が無い扱い）
 */
export async function loadStepLog(owner: string, repo: string, number: number): Promise<StepInfo[]> {
  if (typeof owner !== "string" || typeof repo !== "string" || !Number.isInteger(number) || number <= 0) return [];
  const auth = authorizeOperation({
    login: await getSignedInLogin(),
    token: await getGitHubToken(),
    allowedLogins: getAllowedLogins(),
    watched: (await loadWatchedRepos()).repos,
    owner,
    repo,
  });
  if (!auth.ok) return [];
  try {
    const body = await fetchStepLogBody(new GitHubClient(auth.token), auth.target, number);
    return body ? parseStepLog(body, new Date()) : [];
  } catch {
    return [];
  }
}

/** 手で押す「同期」。監視リポジトリのキャッシュを無視して、すぐ取り直す */
export async function syncNow(): Promise<void> {
  if (await getSignedInLogin()) {
    for (const repo of (await loadWatchedRepos()).repos) invalidateRepoNow(repo);
    // 工場が作った新しいリポジトリを、次の同期で探す（前に調べてから5分たっていなければ、たった後で）
    requestAutoAddCheck(getSettingsRepo());
  }
  refresh();
}
