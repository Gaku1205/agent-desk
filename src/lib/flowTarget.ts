import type { ChatMessage } from "./conversation";
import { getFlow, type Flow } from "./flow";
import type { TurnItem } from "./turn";

export type FlowTargetData = {
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
  current: Pick<TurnItem, "repo" | "issue" | "status"> | null,
  messages: Pick<ChatMessage, "repo" | "number" | "title" | "url" | "running" | "flow">[],
  showRepo: boolean,
): FlowTargetData | null {
  const label = (repo: string, number: number) => `${showRepo ? repo : ""}#${number}`;
  if (current) {
    return {
      label: label(current.repo, current.issue.number),
      title: current.issue.title,
      url: current.issue.url,
      flow: getFlow(current.status),
    };
  }
  const running = messages.find((message) => message.running);
  if (!running) return null;
  return { label: label(running.repo, running.number), title: running.title, url: running.url, flow: running.flow };
}
