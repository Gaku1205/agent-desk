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

type MessageLike = Pick<ChatMessage, "key" | "owner" | "repo" | "number" | "title" | "url" | "running" | "flow">;

/**
 * 進捗図に描く1件（docs/spec.md の「進捗図」）：「いまの様子」で選んだ行（`selected` は `owner/repo#番号`）があれば、その1件。
 * 選んでいない（選んだ行がもう無い）ときは、「あなたの番」に出ている1件。
 * 無ければ、会話の中で動いている物のうち、いちばん上の1件。どれも無ければ null
 */
export function pickFlowTarget(
  current: Pick<TurnItem, "owner" | "repo" | "issue" | "status"> | null,
  messages: MessageLike[],
  showRepo: boolean,
  selected: string | null = null,
): FlowTargetData | null {
  const label = (repo: string, number: number) => `${showRepo ? repo : ""}#${number}`;
  const fromMessage = (message: MessageLike): FlowTargetData => ({
    owner: message.owner,
    repo: message.repo,
    number: message.number,
    label: label(message.repo, message.number),
    title: message.title,
    url: message.url,
    flow: message.flow,
  });
  const chosen = selected === null ? undefined : messages.find((message) => message.key === selected);
  if (chosen) return fromMessage(chosen);
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
  return running ? fromMessage(running) : null;
}

/** 「いまの様子」の行を選んだあとの選び：同じ行をもう一度選ぶと外す（null）。ほかの行なら、その行に替える */
export function toggleFlowSelection(selected: string | null, key: string): string | null {
  return selected === key ? null : key;
}
