// ホームの「いない間のまとめ」の数え方（docs/spec.md の「いない間のまとめ」）。
// ホームがすでに取った出来事と今の「あなたの番」から数えるだけで、GitHub への呼び出しは増やさない

/** まとめを出す最短のあき（2時間） */
export const AWAY_MIN_MS = 2 * 60 * 60 * 1000;
/** 題名を出す公開の数 */
export const AWAY_TITLES = 2;

/** 数える出来事（`TrailEvent` の一部。`id` の終わりで種類を分ける：`…:deployed`・`…:stuck-<コメント>`） */
export type AwayEvent = {
  id: string;
  at: string;
  issue: { owner: string; repo: string; number: number; title: string };
};

/** 今の「あなたの番」の1件（`TurnItem` の一部） */
export type AwayTurn = {
  owner: string;
  repo: string;
  issue: { number: number };
  status: { stage: string };
  waitingSince: string;
};

export type AwaySummary = {
  /** 何時間ぶりか（切り捨て） */
  hours: number;
  deployed: number;
  stuck: number;
  /** 止まった物が全部、今は止まりでなくなっている */
  stuckRecovered: boolean;
  questions: number;
  /** 公開した物の題名（新しい順に2つまで。`#700 …`） */
  titles: string[];
  /** 題名に出さなかった公開の数 */
  more: number;
};

const keyOf = (owner: string, repo: string, number: number): string =>
  `${owner}/${repo}#${number}`.toLowerCase();

/** 覚えた時刻を読む。読めない・未来の時刻は null */
export function parseLastSeen(raw: string | null, now: Date): number | null {
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) || time > now.getTime() ? null : time;
}

/**
 * まとめを返す。出さないとき（前に見た時刻が無い・読めない・2時間未満、数が全部0件）は null。
 * 出来事は前に見た時刻より後、今までのものだけ数える
 */
export function awaySummary(
  lastSeen: string | null,
  now: Date,
  events: AwayEvent[],
  turns: AwayTurn[],
): AwaySummary | null {
  const since = parseLastSeen(lastSeen, now);
  if (since === null || now.getTime() - since < AWAY_MIN_MS) return null;
  const inRange = (at: string): boolean => {
    const time = Date.parse(at);
    return !Number.isNaN(time) && time > since && time <= now.getTime();
  };

  const deployedEvents = events
    .filter((event) => /:deployed$/.test(event.id) && inRange(event.at))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const stuckKeys = new Set(
    events
      .filter((event) => /:stuck-[^:]*$/.test(event.id) && inRange(event.at))
      .map((event) => keyOf(event.issue.owner, event.issue.repo, event.issue.number)),
  );
  const stillStuck = new Set(
    turns
      .filter((turn) => turn.status.stage === "stuck")
      .map((turn) => keyOf(turn.owner, turn.repo, turn.issue.number)),
  );
  const questions = turns.filter(
    (turn) => turn.status.stage === "question" && inRange(turn.waitingSince),
  ).length;

  const deployed = deployedEvents.length;
  if (deployed === 0 && stuckKeys.size === 0 && questions === 0) return null;
  return {
    hours: Math.floor((now.getTime() - since) / (60 * 60 * 1000)),
    deployed,
    stuck: stuckKeys.size,
    stuckRecovered: stuckKeys.size > 0 && [...stuckKeys].every((key) => !stillStuck.has(key)),
    questions,
    titles: deployedEvents.slice(0, AWAY_TITLES).map((event) => `#${event.issue.number} ${event.issue.title}`),
    more: Math.max(0, deployed - AWAY_TITLES),
  };
}
