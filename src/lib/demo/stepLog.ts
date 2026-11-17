import type { RepoResult } from "../github/types";
import { isStepLogComment, parseStepLog, type StepInfo } from "../stepLog";

/** デモ：サンプルのデータの、進捗ログのコメントから、工程ごとの記録を読む（本物の `loadStepLog` のデモ版。GitHub には問い合わせない） */
export function demoStepLog(
  results: readonly RepoResult[],
  owner: string,
  repo: string,
  number: number,
  now: Date,
): StepInfo[] {
  const result = results.find((r) => r.ok && r.owner === owner && r.repo === repo);
  if (!result || !result.ok) return [];
  const comment = result.data.comments.find((c) => c.issueNumber === number && isStepLogComment(c.body));
  return comment ? parseStepLog(comment.body, now) : [];
}
