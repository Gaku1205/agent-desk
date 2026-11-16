import type { WatchedRepo } from "../config";
import { isStepLogComment } from "../stepLog";
import type { GitHubClient } from "./client";

/** Issue のコメントから「進捗ログ」のコメントを探して、本文を返す。無ければ null。API のエラーは投げる */
export async function fetchStepLogBody(
  client: GitHubClient,
  target: WatchedRepo,
  issueNumber: number,
): Promise<string | null> {
  const comments = await client.getAll<{ body?: string | null }>(
    `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${issueNumber}/comments?per_page=100`,
  );
  const found = comments.find((comment) => typeof comment.body === "string" && isStepLogComment(comment.body));
  return found?.body ?? null;
}
