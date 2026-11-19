import type { Drift, RuleName } from "./types";

/** 決まりの日本語の名前（Issue の題名・本文に使う） */
export const RULE_LABELS: Record<RuleName, string> = {
  "all-sections": "区画から漏れ",
  "slots-count": "Slots の数",
  "your-turn-count": "Your turn の数",
  "ai-working": "AI作業中の表示",
  "unreadable-hidden": "読めないリポジトリの表示",
};

/** Issue の題名の頭（#652 の上のバーがこの題名で数える） */
export const DRIFT_TITLE_PREFIX = "表示のずれ：";

export function driftIssueTitle(rule: RuleName): string {
  return `${DRIFT_TITLE_PREFIX}${RULE_LABELS[rule]}`;
}

export type IssueDecision = {
  /** 前回も今回も出ている決まり（Issue にする） */
  raise: RuleName[];
  /** 前回出ていて今回出ていない決まり（直った） */
  fixed: RuleName[];
};

function ruleSet(drifts: Drift[]): Set<RuleName> {
  return new Set(drifts.map((drift) => drift.rule));
}

/** 前回と今回のずれの一覧から、Issue にする決まりと直った決まりを決める（決まり単位。純粋関数） */
export function decideIssues(previous: Drift[], current: Drift[]): IssueDecision {
  const before = ruleSet(previous);
  const now = ruleSet(current);
  const names = Object.keys(RULE_LABELS) as RuleName[];
  return {
    raise: names.filter((name) => before.has(name) && now.has(name)),
    fixed: names.filter((name) => before.has(name) && !now.has(name)),
  };
}

/** Issue・コメントの本文に使う、ずれの一覧 */
export function formatDriftList(rule: RuleName, drifts: Drift[], checkedAt: string): string {
  const lines = drifts
    .filter((drift) => drift.rule === rule)
    .map((drift) => {
      const target = drift.number > 0 ? `${drift.repo}#${drift.number}` : drift.repo;
      return `- ${target}（${RULE_LABELS[rule]}）\n  - 画面ではこう：${drift.shown}\n  - GitHub ではこう：${drift.actual}`;
    });
  return `自己点検で見つかったずれです（点検：${checkedAt}）。\n\n${lines.join("\n")}`;
}

/** 「直りました（時刻）」のコメント。時刻は日本時間の分まで */
export function formatFixedComment(checkedAt: string): string {
  const date = new Date(checkedAt);
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `直りました（${jst} 日本時間）`;
}

const previousByScope = new Map<string, Drift[]>();

/** 前回のずれを取り出し、今回のものに置き換える（初めてなら null。再起動で消えてよい） */
export function swapPreviousDrifts(scope: string, current: Drift[]): Drift[] | null {
  const previous = previousByScope.get(scope) ?? null;
  previousByScope.set(scope, current);
  return previous;
}

/** テスト用 */
export function clearPreviousDriftsForTest(): void {
  previousByScope.clear();
}
