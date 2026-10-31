// Webhook の取り直しの下限の判定（docs/spec.md の「Webhook で取り直す」）。
// 同じリポジトリは、前に取ってから最短15秒あける。

/** 同じリポジトリの取り直しの最短の間隔（ミリ秒）。設定にはしない */
export const REFETCH_MIN_INTERVAL_MS = 15_000;

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
};

export type RefetchDecision = {
  /** 今、取り直してよいか（まだ取っていない・変わっていて15秒たった） */
  refetch: boolean;
  /** 変わっているが15秒たっていないとき、取り直せるまでの秒数（切り上げ）。それ以外は 0 */
  waitSeconds: number;
};

/**
 * 今取り直すか、何秒後か。
 * - まだ取っていない：今
 * - 前に取った後に変わっていない：取り直さない（待ちも無い）
 * - 変わっていて、前に取ってから15秒以上：今（静かなあとの最初の変化はすぐ）
 * - 変わっていて、15秒たっていない：待つ。15秒の間に何回変わっても、たった後の1回にまとまる
 */
export function decideRefetch({
  lastFetchedAt,
  lastChangedAt,
  now,
  reflectedChangedAt,
}: RefetchInput): RefetchDecision {
  if (lastFetchedAt === null) return { refetch: true, waitSeconds: 0 };
  const reflected = reflectedChangedAt ?? lastFetchedAt;
  if (lastChangedAt === null || lastChangedAt <= reflected) return { refetch: false, waitSeconds: 0 };
  const elapsed = now - lastFetchedAt;
  if (elapsed >= REFETCH_MIN_INTERVAL_MS) return { refetch: true, waitSeconds: 0 };
  return { refetch: false, waitSeconds: Math.ceil((REFETCH_MIN_INTERVAL_MS - elapsed) / 1000) };
}
