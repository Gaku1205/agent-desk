"use server";

import { refresh, updateTag } from "next/cache";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { getAllowedLogins } from "@/lib/config";
import { GitHubClient } from "@/lib/github/client";
import { fetchRepoData } from "@/lib/github/fetch";
import {
  authorizeOperation,
  executeOperation,
  OPERATION_MESSAGES,
  operationErrorMessage,
  parseOperationInput,
  type OperationResult,
} from "@/lib/operations";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { repoTag } from "@/lib/webhook";

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
    updateTag(repoTag(auth.target));
    refresh();
  }
  return result;
}

/** 手で押す「同期」。監視リポジトリのキャッシュを無視して、すぐ取り直す */
export async function syncNow(): Promise<void> {
  if (await getSignedInLogin()) {
    for (const repo of (await loadWatchedRepos()).repos) updateTag(repoTag(repo));
  }
  refresh();
}
