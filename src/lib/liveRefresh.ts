import { getWatchedRepos, type WatchedRepo } from "./config";

/**
 * 即時反映（docs/spec.md の「即時反映」）の、サーバーのメモリ内の配り先。
 * 1プロセス前提。開発中の再読み込みやルートごとの読み込みでも同じ物を使うよう、globalThis に置く
 */
type LiveState = {
  listeners: Set<(repo: string) => void>;
  watchedRepos: WatchedRepo[] | null;
};

const STATE_KEY = Symbol.for("agent-desk.liveRefresh");

function state(): LiveState {
  const holder = globalThis as typeof globalThis & { [STATE_KEY]?: LiveState };
  holder[STATE_KEY] ??= { listeners: new Set(), watchedRepos: null };
  return holder[STATE_KEY];
}

/** 「取り直して」を受け取る。戻り値は外す関数 */
export function subscribeLiveRefresh(listener: (repo: string) => void): () => void {
  const { listeners } = state();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** つながっている全部の画面に「取り直して」を伝える。伝えた数を返す */
export function publishLiveRefresh(repo: string): number {
  const listeners = [...state().listeners];
  for (const listener of listeners) {
    try {
      listener(repo);
    } catch {
      // 閉じかけの接続などで失敗しても、ほかの画面には伝える
    }
  }
  return listeners.length;
}

/** 画面を作ったときに使った「監視するリポジトリ」を覚える（Webhookの振り分けに使う） */
export function rememberWatchedRepos(repos: WatchedRepo[]): void {
  state().watchedRepos = repos;
}

/** Webhookの振り分けに使う監視するリポジトリ。まだ画面を作っていなければ `WATCHED_REPOS` */
export function getLiveWatchedRepos(): WatchedRepo[] {
  return state().watchedRepos ?? getWatchedRepos();
}

/** SSEの1通（`event:` と `data:`） */
export function formatSseEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data.replace(/\r?\n/g, " ")}\n\n`;
}

/** 接続を切られないためのコメント行 */
export const SSE_PING = ": ping\n\n";

/** SSEで切られないようにコメント行を送る間隔 */
export const SSE_PING_INTERVAL_MS = 25_000;
