import type { WatchedRepo } from "../config";
import type { GitHubClient } from "./client";
import { GitHubError } from "./errors";

/** 監視するリポジトリを保存する Variable の名前 */
export const WATCHED_REPOS_VARIABLE = "AGENT_DESK_WATCHED_REPOS";

/** 全自動パイプラインのワークフローの場所 */
export const PIPELINE_WORKFLOW_PATH = ".github/workflows/pipeline.yml";

function repoPath({ owner, repo }: WatchedRepo): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** リポジトリの Actions の Variable を読む。無ければ（404）null */
export async function readVariable(
  client: GitHubClient,
  target: WatchedRepo,
  name: string,
): Promise<string | null> {
  try {
    const variable = await client.get<{ value?: unknown }>(
      `${repoPath(target)}/actions/variables/${encodeURIComponent(name)}`,
    );
    return typeof variable?.value === "string" ? variable.value : null;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

/** Variable を書く。まだ無ければ POST で作り、あれば PATCH で変える */
export async function writeVariable(
  client: GitHubClient,
  target: WatchedRepo,
  name: string,
  value: string,
): Promise<void> {
  const exists = (await readVariable(client, target, name)) !== null;
  if (exists) {
    await client.send("PATCH", `${repoPath(target)}/actions/variables/${encodeURIComponent(name)}`, {
      name,
      value,
    });
  } else {
    await client.send("POST", `${repoPath(target)}/actions/variables`, { name, value });
  }
}

/** ログイン中のユーザーが読めるリポジトリの `owner/repo`（最近pushされた順） */
export async function listReadableRepos(client: GitHubClient): Promise<string[]> {
  const repos = await client.getAll<{ full_name?: unknown }>("/user/repos?per_page=100&sort=pushed");
  return repos
    .map((repo) => repo.full_name)
    .filter((name): name is string => typeof name === "string");
}

/** ユーザーがそのリポジトリを読めるか（一覧に入りきらなかった物の確認用） */
export async function canReadRepo(client: GitHubClient, target: WatchedRepo): Promise<boolean> {
  try {
    await client.get<unknown>(repoPath(target));
    return true;
  } catch (error) {
    if (error instanceof GitHubError && (error.kind === "not_found" || error.kind === "forbidden")) {
      return false;
    }
    throw error;
  }
}

/** リポジトリに全自動パイプライン（`.github/workflows/pipeline.yml`）があるか。確かめられなければ「なし」 */
export async function hasPipeline(client: GitHubClient, target: WatchedRepo): Promise<boolean> {
  try {
    await client.get<unknown>(`${repoPath(target)}/contents/${PIPELINE_WORKFLOW_PATH}`);
    return true;
  } catch {
    return false;
  }
}
