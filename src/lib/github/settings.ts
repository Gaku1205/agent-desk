import type { WatchedRepo } from "../config";
import type { GitHubClient } from "./client";
import { GitHubError } from "./errors";
import {
  buildParallelWrites,
  PARALLEL_DAY_VARIABLE,
  PARALLEL_NIGHT_HOURS_VARIABLE,
  PARALLEL_NIGHT_VARIABLE,
  parseParallelSettings,
  type ParallelSettings,
} from "../parallel";

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

/** Variable を消す。もう無ければ（404）何もしない */
export async function deleteVariable(client: GitHubClient, target: WatchedRepo, name: string): Promise<void> {
  try {
    await client.send("DELETE", `${repoPath(target)}/actions/variables/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return;
    throw error;
  }
}

/** リポジトリの並列の設定（`PARALLEL_DAY`・`PARALLEL_NIGHT`・`PARALLEL_NIGHT_HOURS`）を読む。無い・不正な値は既定 */
export async function readParallelSettings(client: GitHubClient, target: WatchedRepo): Promise<ParallelSettings> {
  const [day, night, nightHours] = await Promise.all([
    readVariable(client, target, PARALLEL_DAY_VARIABLE),
    readVariable(client, target, PARALLEL_NIGHT_VARIABLE),
    readVariable(client, target, PARALLEL_NIGHT_HOURS_VARIABLE),
  ]);
  return parseParallelSettings({ day, night, nightHours });
}

/**
 * リポジトリの並列の設定を書く。既定と同じ値・「無し」の Variable は消す（空の値は書けないため）。
 * `PARALLEL_TZ`・`PARALLEL_OVERRIDE` には触らない
 */
export async function writeParallelSettings(
  client: GitHubClient,
  target: WatchedRepo,
  settings: ParallelSettings,
): Promise<void> {
  for (const { name, value } of buildParallelWrites(settings)) {
    if (value === null) await deleteVariable(client, target, name);
    else await writeVariable(client, target, name, value);
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
