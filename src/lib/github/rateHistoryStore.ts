import { getSettingsRepo, type WatchedRepo } from "../config";
import {
  emptyStore,
  isCheckDue,
  mergeStore,
  parseStore,
  RATE_HISTORY_VARIABLE,
  serializeStore,
  shouldWriteStore,
  type RateHistoryStore,
} from "../dashboard/rateHistoryStore";
import { getLiveRateHistories } from "./appToken";
import { GitHubClient, type Fetcher } from "./client";
import { readVariable, writeVariable } from "./settings";

// サーバーだけで使う。書く鍵は設定の保存と同じ、ログインした人のトークン（リクエストの中だけ）。
// 書けなくても（権限・通信・`SETTINGS_REPO` が無い）黙ってメモリだけで続ける。

/** 保存の Variable を読み直さずに使う時間 */
const READ_MEMO_MS = 60 * 1000;

type Memo = { at: number; text: string | null };

let readMemo: Memo | null = null;
/** 前に確かめた（読んで、要れば書いた）時刻。サーバーごと */
let lastCheckedAt: number | null = null;

async function readStoredText(client: GitHubClient, target: WatchedRepo, nowMs: number): Promise<string | null> {
  if (readMemo && nowMs - readMemo.at < READ_MEMO_MS) return readMemo.text;
  const text = await readVariable(client, target, RATE_HISTORY_VARIABLE);
  readMemo = { at: nowMs, text };
  return text;
}

/**
 * 保存した履歴にメモリの点を合わせて返し、前に確かめてから10分以上たっていて中身が変わっていれば書く。
 * `needStore` が false（Dashboard 以外のページ）のときは、確かめる時機でなければ何もしない（GitHub を読まない）。
 * 読めない・書けないときは、メモリだけの中身を返す（例外は出さない）
 */
export async function syncRateHistory(input: {
  userToken: string;
  nowMs: number;
  needStore: boolean;
  settingsRepo?: WatchedRepo | null;
  fetcher?: Fetcher;
}): Promise<RateHistoryStore> {
  const live = getLiveRateHistories(input.userToken);
  const settingsRepo = input.settingsRepo === undefined ? getSettingsRepo() : input.settingsRepo;
  if (!input.userToken || !settingsRepo) return mergeStore(emptyStore(), live, input.nowMs);
  const due = isCheckDue(lastCheckedAt, input.nowMs);
  if (!input.needStore && !due) return emptyStore();
  const client = new GitHubClient(input.userToken, input.fetcher ?? fetch);
  let stored = emptyStore();
  let previous: string | null = null;
  try {
    const text = await readStoredText(client, settingsRepo, input.nowMs);
    stored = parseStore(text);
    previous = serializeStore(stored);
  } catch {
    // 読めなければ、保存は空として扱う（メモリだけで続ける）。書くのも見送る
    return mergeStore(emptyStore(), live, input.nowMs);
  }
  const merged = mergeStore(stored, live, input.nowMs);
  const next = serializeStore(merged);
  if (due) {
    const write = shouldWriteStore({ lastCheckedAt, nowMs: input.nowMs, previous, next });
    lastCheckedAt = input.nowMs;
    if (write && next !== null) {
      try {
        await writeVariable(client, settingsRepo, RATE_HISTORY_VARIABLE, next);
        readMemo = { at: input.nowMs, text: next };
      } catch {
        // 書けなくても画面は止めない
      }
    }
  }
  return merged;
}

/** テスト用 */
export function resetRateHistorySyncForTest(): void {
  readMemo = null;
  lastCheckedAt = null;
}
