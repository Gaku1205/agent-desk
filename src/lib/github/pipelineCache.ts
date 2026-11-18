import { createHash } from "node:crypto";
import type { WatchedRepo } from "../config";
import type { GitHubClient } from "./client";
import { lookupPipeline } from "./settings";

// 設定のページの `hasPipeline`（変わりにくい）を、サーバーのメモリに覚える。再起動で消えてよい。
// 覚えるのは「あり／なし」だけ。通信失敗・レート制限は覚えない。キーはトークンのハッシュ＋リポジトリ（トークンそのものは入れない）

/** 覚える寿命（ミリ秒）：10分 */
export const PIPELINE_MEMO_TTL_MS = 10 * 60 * 1000;
/** 覚える件数の上限 */
export const PIPELINE_MEMO_MAX = 200;

export type PipelineMemo = Map<string, { value: boolean; savedAt: number }>;

/** 覚えるキー。トークンは SHA-256 にして使う。リポジトリ名は大文字小文字を区別しない */
export function pipelineMemoKey(token: string, { owner, repo }: WatchedRepo): string {
  const hash = createHash("sha256").update(token).digest("hex");
  return `${hash}:${owner}/${repo}`.toLowerCase();
}

/** 覚えた物が使えるか（寿命の内か）。使えなければ undefined */
export function readPipelineMemo(
  memo: PipelineMemo,
  key: string,
  now: number,
  ttlMs: number = PIPELINE_MEMO_TTL_MS,
): boolean | undefined {
  const entry = memo.get(key);
  if (!entry) return undefined;
  if (now - entry.savedAt >= ttlMs || now < entry.savedAt) {
    memo.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * 覚える。確かめられなかった結果（null）は覚えない。
 * 上限を越えるときは、寿命が切れた物を捨て、それでも足りなければいちばん古い物から捨てる
 */
export function writePipelineMemo(
  memo: PipelineMemo,
  key: string,
  value: boolean | null,
  now: number,
  max: number = PIPELINE_MEMO_MAX,
  ttlMs: number = PIPELINE_MEMO_TTL_MS,
): void {
  if (value === null) return;
  memo.delete(key);
  if (memo.size >= max) {
    for (const [oldKey, entry] of memo) {
      if (now - entry.savedAt >= ttlMs) memo.delete(oldKey);
    }
  }
  // Map は入れた順に並ぶので、先頭がいちばん古い
  while (memo.size >= max) {
    const oldest = memo.keys().next();
    if (oldest.done) break;
    memo.delete(oldest.value);
  }
  memo.set(key, { value, savedAt: now });
}

const memo: PipelineMemo = new Map();

/** 設定のページ用：覚えていればそれを返し（GitHub を呼ばない）、無ければ読んで、確かめられたときだけ覚える。確かめられなければ「なし」 */
export async function cachedHasPipeline(
  client: GitHubClient,
  token: string,
  target: WatchedRepo,
  now: () => number = Date.now,
): Promise<boolean> {
  const key = pipelineMemoKey(token, target);
  const known = readPipelineMemo(memo, key, now());
  if (known !== undefined) return known;
  const found = await lookupPipeline(client, target);
  writePipelineMemo(memo, key, found, now());
  return found === true;
}

/** テスト用：覚えた物を空にする */
export function clearPipelineMemoForTest(): void {
  memo.clear();
}
