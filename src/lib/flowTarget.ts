import type { ChatMessage } from "./conversation";
import { getFlow, type Flow } from "./flow";
import type { TurnItem } from "./turn";

export type FlowTargetData = {
  /** 進捗ログを読む Issue */
  owner: string;
  repo: string;
  number: number;
  /** `todo-app#23`（1つのリポジトリだけなら `#23`） */
  label: string;
  title: string;
  url: string;
  flow: Flow;
};

/**
 * 進捗図に描く1件（docs/spec.md の「進捗図」）：「あなたの番」に出ている1件。
 * 無ければ、会話の中で動いている物のうち、いちばん上の1件。どちらも無ければ null
 */
export function pickFlowTarget(
  current: Pick<TurnItem, "owner" | "repo" | "issue" | "status"> | null,
  messages: Pick<ChatMessage, "owner" | "repo" | "number" | "title" | "url" | "running" | "flow">[],
  showRepo: boolean,
): FlowTargetData | null {
  const label = (repo: string, number: number) => `${showRepo ? repo : ""}#${number}`;
  if (current) {
    return {
      owner: current.owner,
      repo: current.repo,
      number: current.issue.number,
      label: label(current.repo, current.issue.number),
      title: current.issue.title,
      url: current.issue.url,
      flow: getFlow(current.status),
    };
  }
  const running = messages.find((message) => message.running);
  if (!running) return null;
  return {
    owner: running.owner,
    repo: running.repo,
    number: running.number,
    label: label(running.repo, running.number),
    title: running.title,
    url: running.url,
    flow: running.flow,
  };
}
