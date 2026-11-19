import type { RepoResult } from "../github/types";
import { SELFCHECK_RULES } from "./rules";
import { buildScreen } from "./screen";
import type { Drift, OkResult, RuleInput, Screen } from "./types";

/** 点検の結果を覚える時間 */
export const SELFCHECK_TTL_MS = 5 * 60 * 1000;

/** 返事の中身（鍵は入れない） */
export type SelfcheckReport = {
  checkedAt: string;
  repoCount: number;
  unreadable: string[];
  drifts: Drift[];
};

/** 読めたリポジトリの結果と画面の側の材料から、ずれを集める（純粋関数。`screen` を渡せば画面の側を差し替えられる） */
export function runSelfcheck(results: RepoResult[], now: Date, screen: Screen = buildScreen(results, now)): SelfcheckReport {
  const ok = results.filter((result): result is OkResult => result.ok);
  const unreadable = results.filter((result) => !result.ok).map((result) => `${result.owner}/${result.repo}`);
  const input: RuleInput = { results: ok, unreadable, now, screen };
  const drifts = SELFCHECK_RULES.flatMap((rule) => rule.check(input)).sort(
    (a, b) => a.repo.localeCompare(b.repo) || a.number - b.number || a.rule.localeCompare(b.rule),
  );
  return { checkedAt: now.toISOString(), repoCount: results.length, unreadable, drifts };
}

let memo: { at: number; report: SelfcheckReport } | null = null;
let inFlight: Promise<SelfcheckReport> | null = null;

/** テスト用：覚えた結果を消す */
export function clearSelfcheckMemoForTest(): void {
  memo = null;
  inFlight = null;
}

/**
 * 点検の結果を5分覚える。5分のうちは `read` を呼ばない（GitHub を読み直さない）。同時に呼ばれたら1回にまとめる。
 * 覚えるのは返事だけ（鍵は覚えない）
 */
export async function selfcheckOnce(
  read: () => Promise<RepoResult[]>,
  nowMs: number = Date.now(),
): Promise<SelfcheckReport> {
  if (memo && nowMs - memo.at >= 0 && nowMs - memo.at < SELFCHECK_TTL_MS) return memo.report;
  if (inFlight) return inFlight;
  const started = read()
    .then((results) => {
      const report = runSelfcheck(results, new Date(nowMs));
      memo = { at: nowMs, report };
      return report;
    })
    .finally(() => {
      if (inFlight === started) inFlight = null;
    });
  inFlight = started;
  return started;
}
