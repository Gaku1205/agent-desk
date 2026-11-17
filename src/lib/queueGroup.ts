import type { ChatMessage } from "./conversation";

/**
 * 「いまの様子」の順番待ち（段階 `queued`）を、動いている作業の行から分けて、始まる順に並べる
 * （docs/spec.md の「いまの様子」）。
 * 始まる順：リポジトリの並び順 → リポジトリごとのランプの待ち順（`assignLamps`。急ぎ → ほかの `ai:queue` → `ai:blocked`）。
 * 待ち順を持たない物は、その後ろに番号の小さい順
 */
export function splitQueue(
  messages: ChatMessage[],
  repoOrder: string[] = [],
): { queue: ChatMessage[]; rest: ChatMessage[] } {
  const index = (message: ChatMessage): number => {
    const found = repoOrder.findIndex((full) => full.toLowerCase() === `${message.owner}/${message.repo}`.toLowerCase());
    return found === -1 ? repoOrder.length : found;
  };
  const position = (message: ChatMessage): number =>
    message.lamp.kind === "waiting" ? message.lamp.position : Number.MAX_SAFE_INTEGER;
  const queue = messages
    .filter((message) => message.stage === "queued")
    .sort(
      (a, b) =>
        index(a) - index(b) ||
        `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`) ||
        position(a) - position(b) ||
        a.number - b.number,
    );
  return { queue, rest: messages.filter((message) => message.stage !== "queued") };
}
