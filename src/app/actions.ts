"use server";

import { refresh } from "next/cache";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { getAllowedLogins } from "@/lib/config";
import { GitHubClient } from "@/lib/github/client";
import { fetchRepoData } from "@/lib/github/fetch";
import { invalidateRepoNow } from "@/lib/github/repoCache";
import {
  authorizeOperation,
  executeCreateIssue,
  executeOperation,
  OPERATION_MESSAGES,
  operationErrorMessage,
  parseOperationInput,
  type CreateIssueResult,
  type OperationResult,
} from "@/lib/operations";
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
    return { ok: false, changed: false, message: operationErrorMessage(error) };
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
  if (result.ok) {
    // できたIssueをすぐ出すため、Webhook を待たずにキャッシュを無効にする
    invalidateRepoNow(auth.target);
    refresh();
  }
  return result;
}

/** 手で押す「同期」。監視リポジトリのキャッシュを無視して、すぐ取り直す */
export async function syncNow(): Promise<void> {
  if (await getSignedInLogin()) {
    for (const repo of (await loadWatchedRepos()).repos) invalidateRepoNow(repo);
  }
  refresh();
}
