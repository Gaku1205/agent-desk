// Webhook によるキャッシュの無効化の間引き（docs/spec.md の「Webhook で取り直す」）。純粋な判定だけ

/** 急ぎでない Webhook で、同じリポジトリのキャッシュを無効にする最短の間隔（ミリ秒） */
export const WEBHOOK_INVALIDATE_PERIOD_MS = 30_000;

/** 区切りの番号（30秒ごとに1つ進む） */
export function invalidationPeriod(now: number): number {
  return Math.floor(now / WEBHOOK_INVALIDATE_PERIOD_MS);
}

/** 次の区切りまでの時間（ミリ秒。1以上） */
export function msUntilNextInvalidationPeriod(now: number): number {
  return (invalidationPeriod(now) + 1) * WEBHOOK_INVALIDATE_PERIOD_MS - now;
}

/**
 * 区切りの中の「枠」を取る。取れたら true（その区切りで最初に頼んだ）、もう誰かが取っていたら false。
 * `invalidate`＝その区切りで無効にした印、`flush`＝次の区切りでまとめて無効にする予約
 */
export type ClaimSlot = (kind: "invalidate" | "flush", period: number) => Promise<boolean>;

/** `now`＝今すぐ無効にする、`defer`＝次の区切りでまとめて無効にする予約を、この呼び出しが入れる、`skip`＝何もしない（予約済み） */
export type InvalidationPlan = "now" | "defer" | "skip";

/**
 * 1つの Webhook を、すぐ無効にするか・まとめるかを決める。
 * - 急ぎの知らせは、いつでもすぐ無効にする（その区切りの枠も使うので、続く急ぎでない知らせはまとまる）
 * - 急ぎでない知らせは、その区切りで最初の1回だけすぐ無効にし、残りは次の区切りの1回にまとめる
 */
export async function planInvalidation(input: {
  urgent: boolean;
  now: number;
  claim: ClaimSlot;
}): Promise<InvalidationPlan> {
  const { urgent, now, claim } = input;
  const period = invalidationPeriod(now);
  const first = await claim("invalidate", period);
  if (urgent || first) return "now";
  return (await claim("flush", period)) ? "defer" : "skip";
}
