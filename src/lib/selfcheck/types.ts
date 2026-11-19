import type { ChatMessage } from "../conversation";
import type { RepoData, RepoResult } from "../github/types";
import type { LanesSource } from "../lanes/source";
import type { TurnItem } from "../turn";

/** 決まりの名前（英字のスラッグ。題名に使う日本語の名前は `issues.ts` の `RULE_LABELS`） */
export type RuleName = "all-sections" | "slots-count" | "your-turn-count" | "ai-working" | "unreadable-hidden";

/** 見つけたずれ1件 */
export type Drift = {
  /** `owner/repo` */
  repo: string;
  /** Issue か PR の番号（リポジトリ全体のずれは 0） */
  number: number;
  rule: RuleName;
  /** 画面ではこう */
  shown: string;
  /** GitHub ではこう */
  actual: string;
};

/** 画面の側の材料（画面が使っている関数の結果。`buildScreen`） */
export type Screen = {
  turnItems: TurnItem[];
  lanes: LanesSource;
  messages: ChatMessage[];
  /** 画面に渡している結果のうち、読めなかったリポジトリの行の数 */
  unreadableShown: number;
};

export type OkResult = Extract<RepoResult, { ok: true }>;

export type RuleInput = {
  /** 読めたリポジトリ */
  results: OkResult[];
  /** 読めなかったリポジトリ（`owner/repo`） */
  unreadable: string[];
  now: Date;
  screen: Screen;
};

export type SelfcheckRule = {
  name: RuleName;
  check: (input: RuleInput) => Drift[];
};

export function repoName(result: Pick<RepoResult, "owner" | "repo">): string {
  return `${result.owner}/${result.repo}`;
}

export function issueKey(result: Pick<RepoResult, "owner" | "repo">, number: number): string {
  return `${result.owner}/${result.repo}#${number}`;
}

export type { RepoData };
