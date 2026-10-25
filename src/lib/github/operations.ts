import type { WatchedRepo } from "../config";
import type { GitHubClient } from "./client";
import { PULL_BASE } from "../turn";
import { GitHubError } from "./errors";

function repoPath({ owner, repo }: WatchedRepo): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Issue／PRにラベルを付ける */
export async function addLabel(
  client: GitHubClient,
  target: WatchedRepo,
  number: number,
  label: string,
): Promise<void> {
  await client.send("POST", `${repoPath(target)}/issues/${number}/labels`, { labels: [label] });
}

/** Issue／PRからラベルを外す。もう付いていなければ（404）何もしない */
export async function removeLabel(
  client: GitHubClient,
  target: WatchedRepo,
  number: number,
  label: string,
): Promise<void> {
  try {
    await client.send(
      "DELETE",
      `${repoPath(target)}/issues/${number}/labels/${encodeURIComponent(label)}`,
    );
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return;
    throw error;
  }
}

/** `claude/issue-<番号>-` で始まるブランチのうち、名前がいちばん新しい（後ろの）もの。無ければ null */
export async function findIssueBranch(
  client: GitHubClient,
  target: WatchedRepo,
  issueNumber: number,
): Promise<string | null> {
  const prefix = `claude/issue-${issueNumber}-`;
  const refs = await client.get<{ ref?: string }[]>(
    `${repoPath(target)}/git/matching-refs/heads/${prefix}`,
  );
  const branches = (Array.isArray(refs) ? refs : [])
    .map((ref) => (ref.ref ?? "").replace(/^refs\/heads\//, ""))
    .filter((name) => name.startsWith(prefix))
    .sort();
  return branches.at(-1) ?? null;
}

/** ブランチから main へのPRを作る */
export async function createPull(
  client: GitHubClient,
  target: WatchedRepo,
  pull: { head: string; title: string; body: string },
): Promise<void> {
  await client.send("POST", `${repoPath(target)}/pulls`, { ...pull, base: PULL_BASE });
}

/**
 * PRをマージする。先頭コミットを渡して、確認したあとにpushされていたら失敗させる。
 * マージできない状態（405）・先頭が変わった（409）は "changed" を返す
 */
export async function mergePull(
  client: GitHubClient,
  target: WatchedRepo,
  pullNumber: number,
  headSha: string,
): Promise<"merged" | "changed"> {
  try {
    await client.send("PUT", `${repoPath(target)}/pulls/${pullNumber}/merge`, { sha: headSha });
    return "merged";
  } catch (error) {
    if (error instanceof GitHubError && (error.status === 405 || error.status === 409)) {
      return "changed";
    }
    throw error;
  }
}
