import type { DeployLink } from "./deployStatus";
import { describeStatus, failureLogUrl } from "./describe";
import { groupTrails, type TrailStep } from "./eventGroups";
import type { TrailEvent } from "./events";
import { getFlow, type Flow } from "./flow";
import type { RepoResult } from "./github/types";
import { buildPipelineRows } from "./pipeline";
import { isRunningStage } from "./runningPipeline";
import type { IssueStatus, Stage } from "./status";
import { turnRowDescription } from "./turn";

/**
 * 「いまの様子」（会話）：進行中の作業を、会話のメッセージのように並べる（docs/spec.md の「いまの様子」）。
 * 「あなたの番」に出る物は出さない
 */

/** 会話の1行：話し手と、今の様子の文（docs/design.md の「段階ごとの説明文」の「会話の文」） */
export type ChatLine = { speaker: string; text: string };

export type ChatLineOptions = {
  /** 順番待ちで、理由に書かれた前の Issue の番号（無ければ null） */
  queueAfter?: number | null;
};

/** 段階から、話し手と会話の文を決める。人間の番の段階は、ふつう会話には出ない（説明文をそのまま使う） */
export function chatLine(status: IssueStatus, options: ChatLineOptions = {}): ChatLine {
  const ci = `${status.ci.passed}/${status.ci.total}`;
  switch (status.stage) {
    case "planning":
      return { speaker: "企画AI", text: "いま企画AIがIssueを清書しています" };
    case "implementing":
      return { speaker: "AI", text: "いまAIが実装しています" };
    case "fixing": {
      const n = Math.min(Math.max(status.fixCount, 1), 2);
      return { speaker: "AI", text: `いまAIが直しています（${n}/2 回目）` };
    }
    case "ciRunning":
      return status.verifyingFix
        ? { speaker: "CI", text: `直した結果を、いまCIとレビューで確かめています（CI ${ci}）` }
        : { speaker: "CI", text: `いまCIが確かめています（${ci} 通過）` };
    case "ciFailed":
      return { speaker: "CI", text: "CIが失敗しました。このあとAIが直します" };
    case "reviewing":
      return status.verifyingFix
        ? { speaker: "CI", text: `直した結果を、いまCIとレビューで確かめています（CI ${ci}）` }
        : { speaker: "レビューAI", text: "いまレビューAIが確認しています" };
    case "mergeWaiting":
      if (status.mergeWait === "autoMerge") {
        return { speaker: "パイプライン", text: "CIもレビューもOKです。まもなく自動でマージします" };
      }
      if (status.mergeWait === "needsReview") {
        return { speaker: "パイプライン", text: `CIが通りました（${ci}）。このあとレビューに回します` };
      }
      break;
    case "deploying":
      return { speaker: "本番", text: "いま本番に公開しています" };
    case "deployed":
      return status.deployUnknown
        ? { speaker: "本番", text: "マージしました。公開状況は分かりません" }
        : { speaker: "本番", text: "本番に公開しました" };
    case "queued": {
      const after = options.queueAfter ?? null;
      return {
        speaker: "パイプライン",
        text: after === null ? "前の作業が終わるのを待っています" : `前の作業が終わるのを待っています（#${after} の後）`,
      };
    }
    case "retrying":
      return { speaker: "パイプライン", text: describeStatus(status).long };
    case "notStarted":
      if (status.grace === "intake") {
        return { speaker: "パイプライン", text: "いまパイプラインの受付が、企画に回すか決めています" };
      }
      // 会話に出る未着手は、工場が受け持つ「新サービス：」の Issue だけ（ほかは「あなたの番」に出る）
      return { speaker: "工場", text: "工場が受け持ちます。相談が届くまで待っています" };
    case "prWaiting":
      if (status.grace === "creatingPull") {
        return { speaker: "パイプライン", text: "AIの作業が終わりました。いまパイプラインがPRを作っています" };
      }
      break;
  }
  return { speaker: "パイプライン", text: describeStatus(status).long };
}

/** 会話の1つのメッセージ（1件の Issue） */
export type ChatMessage = {
  /** `owner/repo#番号` */
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  stage: Stage;
  speaker: string;
  text: string;
  /** 話し手を失敗の色にするか（CI失敗） */
  failed: boolean;
  /** 文の下に出す理由（順番待ちの理由）。無ければ null */
  note: string | null;
  /** やり直しの理由に付いた、このリポジトリのログのURL */
  logUrl: string | null;
  /** 公開済みの、公開先へのリンク */
  links: DeployLink[];
  /** 直近3日の出来事（古い順） */
  steps: TrailStep[];
  /** いちばん新しい出来事の時刻（無ければ null） */
  latestAt: string | null;
  /** 公開済み（ふだんは隠す） */
  deployed: boolean;
  /** AIの番で動いている（`isRunningStage`）。進捗図に描く1件を選ぶのに使う */
  running: boolean;
  /** 進捗図の7つの工程の状態 */
  flow: Flow;
};

/** 順番待ちの理由の中の Issue 番号（`#17`）。無ければ null */
export function queueAfterNumber(reason: string | null): number | null {
  const match = reason?.match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

/** 新しい出来事がある物が先。出来事が無い物はその下に、番号の大きい順 */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  if (a.latestAt !== null && b.latestAt !== null) {
    return b.latestAt.localeCompare(a.latestAt) || a.key.localeCompare(b.key);
  }
  if (a.latestAt !== null) return -1;
  if (b.latestAt !== null) return 1;
  return b.number - a.number || a.key.localeCompare(b.key);
}

/**
 * 取得できたリポジトリ全部（または1つ）の会話のメッセージ。「あなたの番」に出る Issue は外す。
 * events は `buildTrailEvents` の結果（直近3日・最大50件）
 */
export function buildConversation(
  results: RepoResult[],
  events: TrailEvent[],
  now: Date,
  filter?: { owner: string; repo: string },
): ChatMessage[] {
  const trails = new Map(groupTrails(events).map((trail) => [trail.key, trail]));
  const messages: ChatMessage[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    if (
      filter &&
      (result.owner.toLowerCase() !== filter.owner.toLowerCase() ||
        result.repo.toLowerCase() !== filter.repo.toLowerCase())
    ) {
      continue;
    }
    const full = `${result.owner}/${result.repo}`;
    const issues = new Map(result.data.issues.map((issue) => [issue.number, issue]));
    for (const row of buildPipelineRows(result.data, now, full)) {
      const issue = issues.get(row.issue.number);
      if (!issue) continue;
      // 「あなたの番」に出る物は、ここには出さない
      if (turnRowDescription(issue, row.status, result.data, full) !== null) continue;
      const key = `${full}#${row.issue.number}`;
      const trail = trails.get(key);
      const line = chatLine(row.status, { queueAfter: queueAfterNumber(row.queueReason) });
      messages.push({
        key,
        owner: result.owner,
        repo: result.repo,
        number: row.issue.number,
        title: row.issue.title,
        url: row.issue.url,
        stage: row.status.stage,
        speaker: line.speaker,
        text: line.text,
        failed: row.status.stage === "ciFailed",
        note: row.queueReason,
        logUrl: failureLogUrl(row.status, full),
        links: row.deployLinks,
        steps: trail?.steps ?? [],
        latestAt: trail?.latestAt ?? null,
        deployed: row.status.stage === "deployed",
        running: isRunningStage(row.status.stage, row.status.grace),
        flow: getFlow(row.status),
      });
    }
  }
  return messages.sort(compareMessages);
}
