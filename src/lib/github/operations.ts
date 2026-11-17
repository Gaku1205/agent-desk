import type { WatchedRepo } from "../config";
import type { GitHubClient } from "./client";
import { PULL_BASE } from "../turn";
import { GitHubError } from "./errors";
import { IMAGES_BRANCH, imageUrl } from "../issueImages";

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

/** Issue／PRにコメントを書く（企画AIの質問への答え） */
export async function addComment(
  client: GitHubClient,
  target: WatchedRepo,
  number: number,
  body: string,
): Promise<void> {
  await client.send("POST", `${repoPath(target)}/issues/${number}/comments`, { body });
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

/** そのリポジトリがテンプレートリポジトリか（`is_template`）。分からなければ false */
export async function fetchIsTemplate(client: GitHubClient, target: WatchedRepo): Promise<boolean> {
  const repo = await client.get<{ is_template?: boolean }>(repoPath(target));
  return repo?.is_template === true;
}

/** Issueを作る（ラベルは付けない）。作ったIssueの番号とURLを返す */
export async function createIssue(
  client: GitHubClient,
  target: WatchedRepo,
  issue: { title: string; body: string },
): Promise<{ number: number; url: string }> {
  const created = (await client.send("POST", `${repoPath(target)}/issues`, {
    title: issue.title,
    // 本文が空のときは送らない（GitHubが空の本文として作る）
    ...(issue.body === "" ? {} : { body: issue.body }),
  })) as { number?: unknown; html_url?: unknown } | null;
  if (typeof created?.number !== "number" || typeof created.html_url !== "string") {
    throw new GitHubError("other", null, null, "user");
  }
  return { number: created.number, url: created.html_url };
}

/**
 * 画像を入れる専用ブランチを用意する。無ければ、`.gitkeep` だけを入れた、親の無いコミットから作る（main の履歴・中身は持ち込まない）。
 * 空のツリーは GitHub が断る（422）ので、`.gitkeep` を1つ入れる。
 * 同時に作られて既にあったとき（422）は、そのまま使う
 */
export async function ensureImagesBranch(client: GitHubClient, target: WatchedRepo): Promise<void> {
  try {
    await client.get(`${repoPath(target)}/git/ref/heads/${IMAGES_BRANCH}`);
    return;
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
  }
  const tree = (await client.send("POST", `${repoPath(target)}/git/trees`, {
    tree: [{ path: ".gitkeep", mode: "100644", type: "blob", content: "" }],
  })) as { sha?: unknown } | null;
  if (typeof tree?.sha !== "string") throw new GitHubError("other", null, null, "user");
  const commit = (await client.send("POST", `${repoPath(target)}/git/commits`, {
    message: "画像の置き場所を作る",
    tree: tree.sha,
    parents: [],
  })) as { sha?: unknown } | null;
  if (typeof commit?.sha !== "string") throw new GitHubError("other", null, null, "user");
  try {
    await client.send("POST", `${repoPath(target)}/git/refs`, {
      ref: `refs/heads/${IMAGES_BRANCH}`,
      sha: commit.sha,
    });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) return;
    throw error;
  }
}

/** 画像を専用ブランチに1枚入れる（Contents API）。入れた場所の URL を返す */
export async function uploadIssueImage(
  client: GitHubClient,
  target: WatchedRepo,
  path: string,
  bytes: Uint8Array,
): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  await client.send("PUT", `${repoPath(target)}/contents/${encodedPath}`, {
    message: "Issueの画像を追加",
    content: Buffer.from(bytes).toString("base64"),
    branch: IMAGES_BRANCH,
  });
  return imageUrl(target.owner, target.repo, path);
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
