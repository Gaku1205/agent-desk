// Webhook の取り直しの下限の判定（docs/spec.md の「Webhook で取り直す」）。
// 同じリポジトリは、前に取ってから最短15秒あける。変わり続けている間は、あける時間を60秒まで延ばす。

/** 同じリポジトリの取り直しの最短の間隔（ミリ秒）。設定にはしない */
export const REFETCH_MIN_INTERVAL_MS = 15_000;
/** 変わり続けているリポジトリの取り直しの間隔の上限（ミリ秒） */
export const REFETCH_MAX_INTERVAL_MS = 60_000;
/** 前に取ってからこれだけ静かなら、間隔を最短に戻す（ミリ秒） */
export const REFETCH_QUIET_RESET_MS = 120_000;

/**
 * 次の取り直しまであける時間（ミリ秒）。取り直すと決めたときに呼ぶ。
 * - 前に取ってから2分以上たっていた（静かだった）：最短の15秒
 * - 2分たたないうちにまた取り直す（変わり続けている）：前の間隔の2倍。上限は60秒（15秒 → 30秒 → 60秒）
 * 作業が続くリポジトリの取り直しを、1時間240回（15秒ごと）から60回ほどに抑える。静かなあとの最初の変化は、今までどおりすぐ出る
 */
export function nextRefetchIntervalMs(input: {
  /** 今回の取り直しまで使っていた間隔（ミリ秒）。分からなければ null */
  previousIntervalMs: number | null;
  /** 前に取ってからの時間（ミリ秒） */
  sinceLastFetchMs: number;
}): number {
  const { previousIntervalMs, sinceLastFetchMs } = input;
  if (!(sinceLastFetchMs < REFETCH_QUIET_RESET_MS)) return REFETCH_MIN_INTERVAL_MS;
  const previous =
    previousIntervalMs !== null && Number.isFinite(previousIntervalMs) && previousIntervalMs > 0
      ? previousIntervalMs
      : REFETCH_MIN_INTERVAL_MS;
  return Math.min(Math.max(previous * 2, REFETCH_MIN_INTERVAL_MS), REFETCH_MAX_INTERVAL_MS);
}

export type RefetchInput = {
  /** 前に取った時刻（ミリ秒）。まだ取っていなければ null */
  lastFetchedAt: number | null;
  /** 最後に変わった時刻（ミリ秒）。変わった知らせが無ければ null */
  lastChangedAt: number | null;
  /** 今の時刻（ミリ秒） */
  now: number;
  /**
   * 前に取ったデータに反映済みの「最後に変わった時刻」（ミリ秒）。渡したときは、変わったかをこれと比べる
   * （渡さないときは前に取った時刻と比べる）
   */
  reflectedChangedAt?: number;
  /** 前に取ってからあける時間（ミリ秒）。渡さなければ最短の15秒 */
  minIntervalMs?: number;
};

export type RefetchDecision = {
  /** 今、取り直してよいか（まだ取っていない・変わっていて、あける時間がたった） */
  refetch: boolean;
  /** 変わっているが、あける時間がたっていないとき、取り直せるまでの秒数（切り上げ）。それ以外は 0 */
  waitSeconds: number;
};

/**
 * 今取り直すか、何秒後か。
 * - まだ取っていない：今
 * - 前に取った後に変わっていない：取り直さない（待ちも無い）
 * - 変わっていて、前に取ってから15秒以上：今（静かなあとの最初の変化はすぐ）
 * - 変わっていて、15秒たっていない：待つ。15秒の間に何回変わっても、たった後の1回にまとまる
 * 「15秒」は、`minIntervalMs` を渡したときはその時間（変わり続けているリポジトリは60秒まで延びる。`nextRefetchIntervalMs`）
 */
export function decideRefetch({
  lastFetchedAt,
  lastChangedAt,
  now,
  reflectedChangedAt,
  minIntervalMs = REFETCH_MIN_INTERVAL_MS,
}: RefetchInput): RefetchDecision {
  if (lastFetchedAt === null) return { refetch: true, waitSeconds: 0 };
  const reflected = reflectedChangedAt ?? lastFetchedAt;
  if (lastChangedAt === null || lastChangedAt <= reflected) return { refetch: false, waitSeconds: 0 };
  const elapsed = now - lastFetchedAt;
  if (elapsed >= minIntervalMs) return { refetch: true, waitSeconds: 0 };
  return { refetch: false, waitSeconds: Math.ceil((minIntervalMs - elapsed) / 1000) };
}
