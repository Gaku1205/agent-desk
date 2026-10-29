import type { DeployLink } from "../deployStatus";
import type { RepoResult } from "../github/types";
import { buildPipelineRows, type PipelineRow } from "../pipeline";
import { PROGRESS_STAGE_NAMES } from "../progress";
import type { IssueStatus } from "../status";
import { describeStatus } from "../describe";
import { parseFailureReason } from "../failureReason";

/** 流れの中の光の色（誰の番か）。docs/design.md の「流れ」 */
export type FlowWho = "human" | "ai" | "queue" | "fail" | "done";

/** 流れに浮かぶ1つのIssue（光の粒と名札） */
export type FlowNode = {
  /** `owner/repo#番号`（画面のキー） */
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** 段階の列（0 清書 〜 7 公開） */
  at: number;
  who: FlowWho;
  /** 名札の短い説明（「止まっています」など） */
  label: string;
  /** 乗せた・押したときに流れの下に出す説明（理由があれば理由） */
  caption: string;
  /** 公開済みの行の、公開先へのリンク */
  deployLinks: DeployLink[];
  /** 止まった理由のログのURL（この行のリポジトリの物だけ） */
  logUrl: string | null;
  /** 人間の判断待ち（押す列にも出る物） */
  turn: boolean;
  /** 急ぐ物（止まった・公開失敗）。流れの中で強い色の名札を出すのはこれだけ */
  urgent: boolean;
};

/** 段階ごとの件数（0 清書 〜 7 公開） */
export type StageCounts = number[];

/** 段階と誰の番かから、光の色を決める */
export function whoOf(status: Pick<IssueStatus, "stage" | "turn">): FlowWho {
  switch (status.stage) {
    case "deployed":
      return "done";
    case "ciFailed":
    case "deployFailed":
      return "fail";
    case "queued":
    case "retrying":
      return "queue";
    default:
      return status.turn === "human" ? "human" : "ai";
  }
}

/** 急ぐ物か：止まった・公開失敗（押す列で強い色を使う行と同じ。docs/design.md の「流れ」） */
export function isUrgentStage(stage: IssueStatus["stage"]): boolean {
  return stage === "stuck" || stage === "deployFailed";
}

/** 流れの名札に出す短い説明。順番待ちは「順番待ち · #17 の後」のように、理由の中の Issue 番号を添える */
export function flowLabel(row: PipelineRow): string {
  if (row.queuePosition !== null && row.queueReason) {
    const match = row.queueReason.match(/#(\d+)/);
    if (match) return `順番待ち · #${match[1]} の後`;
  }
  return row.description;
}

/**
 * 説明文から、名札の短い説明と同じ言い回しの塊を外す（docs/design.md の「流れ」の説明）。
 * 説明文を「・」「。」で分けた塊のうち、短い説明（3文字以上）を含む物を出さない。
 * `マージできます` ＋ `CI 4/4 通過・マージできます` → `CI 4/4 通過`。全部外れたら空文字
 */
export function dedupeCaption(label: string, text: string): string {
  const short = label.trim();
  if (short.length < 3) return text;
  const clauses = text.match(/[^・。]+[・。]?/g) ?? [];
  const kept = clauses.filter((clause) => !clause.replace(/[・。]$/, "").includes(short));
  return kept.join("").replace(/^[・。]+|[・。]+$/g, "");
}

/** 流れの下に出す説明：理由があれば理由、無ければ「あなたの番」と同じ長い説明文（名札と同じ言い回しは外す） */
export function flowCaption(row: PipelineRow, repo: string): string {
  if (row.queueReason) return row.queueReason;
  if (row.deployFailReason) return row.deployFailReason;
  const { long, short } = describeStatus(row.status, { repo });
  return dedupeCaption(short, long);
}

function logUrlOf(status: IssueStatus, repo: string): string | null {
  const reason =
    status.stage === "stuck" ? (status.stuckReason ?? "") : status.stage === "retrying" ? (status.retry?.reason ?? "") : null;
  return reason === null ? null : parseFailureReason(reason, repo).logUrl;
}

/** パイプライン表の1行を、流れの1つの光にする */
export function rowToNode(owner: string, repo: string, row: PipelineRow): FlowNode {
  const full = `${owner}/${repo}`;
  return {
    key: `${full}#${row.issue.number}`,
    owner,
    repo,
    number: row.issue.number,
    title: row.issue.title,
    url: row.issue.url,
    at: row.status.stage === "deployed" ? 7 : row.progress.at,
    who: whoOf(row.status),
    label: flowLabel(row),
    caption: flowCaption(row, full),
    deployLinks: row.deployLinks,
    logUrl: logUrlOf(row.status, full),
    turn: row.status.turn === "human",
    urgent: isUrgentStage(row.status.stage),
  };
}

/** 取得できたリポジトリ全部（または1つ）の、流れに出すIssue。あなたの番 → 失敗 → AIの番 → 待機 → 公開済み の順、同じなら番号の大きい順 */
export function buildFlowNodes(
  results: RepoResult[],
  now: Date,
  filter?: { owner: string; repo: string },
): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    if (
      filter &&
      (result.owner.toLowerCase() !== filter.owner.toLowerCase() ||
        result.repo.toLowerCase() !== filter.repo.toLowerCase())
    ) {
      continue;
    }
    for (const row of buildPipelineRows(result.data, now, `${result.owner}/${result.repo}`)) {
      nodes.push(rowToNode(result.owner, result.repo, row));
    }
  }
  return nodes.sort(compareFlowNodes);
}

const WHO_ORDER: Record<FlowWho, number> = { human: 0, fail: 1, ai: 2, queue: 3, done: 4 };

/** 流れの中の並び：人間の番が先（上のレーン）、公開済みが最後 */
export function compareFlowNodes(a: FlowNode, b: FlowNode): number {
  return (
    WHO_ORDER[a.who] - WHO_ORDER[b.who] ||
    b.number - a.number ||
    `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`)
  );
}

/** 段階ごとの件数 */
export function countByStage(nodes: FlowNode[]): StageCounts {
  const counts = PROGRESS_STAGE_NAMES.map(() => 0);
  for (const node of nodes) counts[node.at] += 1;
  return counts;
}
