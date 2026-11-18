// Webhook の取り直しの決め方（docs/spec.md の「Webhook で取り直す」の「取り直しの持ち分」）。
// 同じリポジトリの取り直しは「持ち分」で数える：60秒の区切りごとに1回分ができ、できた区切りと次の区切りの間だけ使える
// （ためておけるのは最大2回分）。
// 急ぎの知らせ（段階・誰の番が変わりうる物）は持ち分が1回分あればすぐ、
// 急ぎでない知らせ（作業中のコメントの書き換えなど）は持ち分が2回分あるときだけ（急ぎの分を1回残して）取り直す。
// 取り直しの回数は「2回 ＋ またいだ区切りの数」までで、どの1時間でも最大62回
// （間隔を15秒 → 30秒 → 60秒と延ばしていたときの上限と同じ）。急ぎでない知らせだけなら、どの時点でも前の決まりの回数以下。

/** 急ぎの知らせの取り直しの最短の間隔（ミリ秒）。続けて届く知らせ（ラベルの付け替えなど）を1回にまとめる */
export const REFETCH_URGENT_MIN_INTERVAL_MS = 5_000;
/** 持ち分が1回分できる区切りの長さ（ミリ秒）。設定にはしない */
export const REFETCH_PERIOD_MS = 60_000;

/** 持ち分を使った記録：取り直しを許した「最後に変わった時刻」、そのとき見た「最後に急ぎの知らせが来た時刻」、使った時刻。ミリ秒 */
export type RefetchRecord = { changedAt: number; urgentAt: number; at: number };

/** 今の区切りの番号（この番号の持ち分と、1つ前の番号の持ち分が使える） */
export function refetchPeriod(now: number): number {
  return Math.floor(now / REFETCH_PERIOD_MS);
}

/**
 * その変化は、もう片づいているか（記録を調べなくてよいか）。
 * 「最後に変わった時刻」が2つ前の区切りの始まりより前なら、片づいている：その後にできた持ち分（次の区切りの分）は、
 * 画面が見ている間は使われるか（＝その変化が取り直される）、使われないまま期限が切れている（その1回分で取り直した物として数える）
 */
export function isSettledChange(changedAt: number, now: number): boolean {
  return changedAt < (refetchPeriod(now) - 2) * REFETCH_PERIOD_MS;
}

export type RefetchInput = {
  /** 今の時刻（ミリ秒） */
  now: number;
  /** 最後に変わった時刻（ミリ秒） */
  changedAt: number;
  /** 最後に急ぎの知らせが来た時刻（ミリ秒）。記録に覚えた物と違えば、その後に急ぎの知らせが来ている */
  urgentAt: number;
  /** 今の区切りの持ち分を使った記録。まだ使っていなければ null */
  current: RefetchRecord | null;
  /** 1つ前の区切りの持ち分を使った記録。まだ使っていなければ null */
  previous: RefetchRecord | null;
};

export type RefetchDecision = {
  /** 今、取り直してよいなら、使う持ち分（`previous`＝1つ前の区切りの分から先に使う）。取り直さないなら null */
  spend: "previous" | "current" | null;
  /** 記録にある、いちばん新しく取り直しを許した「最後に変わった時刻」。記録が無ければ null */
  released: number | null;
};

/** 2つの記録のうち、後に使った方 */
function latestRecord(a: RefetchRecord | null, b: RefetchRecord | null): RefetchRecord | null {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}

/**
 * 今取り直すか（どの持ち分を使うか）。
 * - 記録にある物より後に変わっていない：取り直さない
 * - 持ち分が2回分とも残っている（1分以上静かだった）：すぐ取り直す
 * - 急ぎの知らせが来ていて、前に取ってから5秒以上：残っている1回分ですぐ取り直す
 * - それ以外（急ぎでない知らせだけ・持ち分が無い）：待つ。待つ間に何回変わっても、取り直せるようになった後の1回にまとまる
 * 静かだったリポジトリの最初の変化はすぐ、そのあと変わり続ける間は区切りごと（60秒ごと）。その間も、急ぎの知らせは残してある1回分ですぐ出る
 */
export function decideRefetch({ now, changedAt, urgentAt, current, previous }: RefetchInput): RefetchDecision {
  const latest = latestRecord(current, previous);
  if (!latest) return { spend: "previous", released: null };
  const released = Math.max(current?.changedAt ?? 0, previous?.changedAt ?? 0);
  if (released >= changedAt) return { spend: null, released };
  const free = !previous ? "previous" : !current ? "current" : null;
  const urgent = urgentAt !== latest.urgentAt;
  if (free && urgent && now - latest.at >= REFETCH_URGENT_MIN_INTERVAL_MS) return { spend: free, released };
  return { spend: null, released };
}
