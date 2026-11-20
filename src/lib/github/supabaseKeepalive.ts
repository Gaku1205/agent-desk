import { createHash } from "node:crypto";
import type { WatchedRepo } from "../config";
import { supabaseVerdict, type KeepaliveRun, type SupabaseKeepalive } from "../dashboard/services";
import { GitHubClient, type Fetcher } from "./client";
import { GitHubError } from "./errors";

// Dashboard の Services の Supabase の行（docs/spec.md の「Dashboard」の「Services」）。サーバーだけで使う。
// 監視リポジトリごとに `supabase-keepalive.yml` の終わった実行を読む。5分覚える（404 の「無い」も覚える。失敗は覚えない）。

export const KEEPALIVE_WORKFLOW = "supabase-keepalive.yml";
/** 覚える寿命：5分 */
export const SERVICES_MEMO_TTL_MS = 5 * 60 * 1000;
/** 覚える件数の上限 */
export const SERVICES_MEMO_MAX = 200;

/** 1リポジトリの答え。none＝ワークフローが無い・実行が無い */
type Answer = SupabaseKeepalive | "none";

const memo = new Map<string, { value: Answer; savedAt: number }>();

function memoKey(token: string, { owner, repo }: WatchedRepo): string {
  return `${createHash("sha256").update(token).digest("hex")}:${owner}/${repo}`.toLowerCase();
}

function readMemo(key: string, nowMs: number): Answer | undefined {
  const entry = memo.get(key);
  if (!entry) return undefined;
  if (nowMs - entry.savedAt >= SERVICES_MEMO_TTL_MS || nowMs < entry.savedAt) {
    memo.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeMemo(key: string, value: Answer, nowMs: number): void {
  memo.delete(key);
  while (memo.size >= SERVICES_MEMO_MAX) {
    const oldest = memo.keys().next();
    if (oldest.done) break;
    memo.delete(oldest.value);
  }
  memo.set(key, { value, savedAt: nowMs });
}

/** テスト用：覚えた物を空にする */
export function clearSupabaseMemoForTest(): void {
  memo.clear();
}

function repoPath({ owner, repo }: WatchedRepo): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function parseRuns(json: unknown): KeepaliveRun[] | null {
  const list = (json as { workflow_runs?: unknown } | null)?.workflow_runs;
  if (!Array.isArray(list)) return null;
  const runs: KeepaliveRun[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const createdAt = typeof item?.created_at === "string" ? Date.parse(item.created_at) : NaN;
    if (typeof item?.id !== "number" || Number.isNaN(createdAt)) continue;
    runs.push({
      id: item.id,
      conclusion: typeof item.conclusion === "string" ? item.conclusion : null,
      createdAt,
      htmlUrl: typeof item.html_url === "string" ? item.html_url : null,
    });
  }
  return runs;
}

/** 失敗したジョブの注釈を1つの文にする。読めなければ null（補助の情報なので、失敗しても行は出す） */
async function failureMessage(client: GitHubClient, target: WatchedRepo, runId: number): Promise<string | null> {
  try {
    const jobs = await client.get<{ jobs?: unknown }>(
      `${repoPath(target)}/actions/runs/${runId}/jobs?filter=latest&per_page=10`,
    );
    if (!Array.isArray(jobs?.jobs)) return null;
    const failed = (jobs.jobs as { id?: unknown; conclusion?: unknown }[]).find(
      (job) => typeof job.id === "number" && job.conclusion !== "success" && job.conclusion !== "skipped",
    );
    if (!failed) return null;
    const annotations = await client.get<unknown>(`${repoPath(target)}/check-runs/${failed.id as number}/annotations`);
    if (!Array.isArray(annotations)) return null;
    const text = (annotations as { message?: unknown; title?: unknown }[])
      .flatMap((a) => [a.title, a.message].filter((v): v is string => typeof v === "string" && v !== ""))
      .join("\n");
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/** 1リポジトリを読む。読めなかった（404 以外の失敗）ときは null */
async function readOne(client: GitHubClient, target: WatchedRepo): Promise<Answer | null> {
  let json: unknown;
  try {
    json = await client.get<unknown>(
      `${repoPath(target)}/actions/workflows/${KEEPALIVE_WORKFLOW}/runs?status=completed&per_page=10`,
    );
  } catch (error) {
    if (error instanceof GitHubError && error.kind === "not_found") return "none";
    return null;
  }
  const runs = parseRuns(json);
  if (runs === null) return null;
  const verdict = supabaseVerdict(runs);
  if (verdict === null) return "none";
  const message = verdict.ok ? null : await failureMessage(client, target, verdict.latest.id);
  return {
    owner: target.owner,
    repo: target.repo,
    ok: verdict.ok,
    at: verdict.latest.createdAt,
    failingSince: verdict.failingSince,
    message,
    logUrl: verdict.latest.htmlUrl,
  };
}

/**
 * 監視リポジトリの Supabase の見張りの様子。見張りが無い・読めなかったリポジトリは入らない。
 * `knownOnly` のときは GitHub を読まず、覚えている物だけ返す（全部がそろう前の段用）
 */
export async function loadSupabaseKeepalives(input: {
  token: string;
  repos: WatchedRepo[];
  nowMs: number;
  knownOnly?: boolean;
  fetcher?: Fetcher;
}): Promise<SupabaseKeepalive[]> {
  if (!input.token) return [];
  const client = new GitHubClient(input.token, input.fetcher ?? fetch);
  const answers = await Promise.all(
    input.repos.map(async (target): Promise<Answer | null> => {
      const key = memoKey(input.token, target);
      const known = readMemo(key, input.nowMs);
      if (known !== undefined || input.knownOnly) return known ?? null;
      const answer = await readOne(client, target);
      if (answer !== null) writeMemo(key, answer, input.nowMs);
      return answer;
    }),
  );
  return answers.filter((answer): answer is SupabaseKeepalive => answer !== null && answer !== "none");
}
