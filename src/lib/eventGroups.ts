import { dayHeading, formatEventTime, type EventIssue, type EventTone, type TrailEvent } from "./events";

/**
 * 出来事を Issue ごとにまとめる（docs/design.md の「出来事」）。
 * 日ごとのタブ（今日・昨日・それより前）の中で、Issue ごとに1つの列（足あと）にする
 */

/** 足あとの1つ：時刻と短い文言 */
export type TrailStep = {
  id: string;
  at: string;
  /** `16:57` */
  time: string;
  short: string;
  tone: EventTone;
};

/** 1つの Issue の足あと（時刻の古い順） */
export type IssueTrail = {
  key: string;
  issue: EventIssue;
  steps: TrailStep[];
  /** いちばん新しい出来事の時刻（並び順に使う） */
  latestAt: string;
};

/** 公開済み（今の段階が `deployed`）の Issue か。公開失敗・公開中は含めない */
export function isDeployedTrail(trail: IssueTrail): boolean {
  return trail.issue.stage === "deployed";
}

/** 今の足あと：いちばん新しい1つ（`steps` は古い順なので最後） */
export function currentStep(trail: IssueTrail): TrailStep {
  return trail.steps[trail.steps.length - 1];
}

/** 公開済みの Issue とそれ以外に分ける（それぞれ並びは変えない） */
export function splitDeployed(trails: IssueTrail[]): { active: IssueTrail[]; deployed: IssueTrail[] } {
  return {
    active: trails.filter((trail) => !isDeployedTrail(trail)),
    deployed: trails.filter(isDeployedTrail),
  };
}

/** 日ごとのタブ */
export type TrailDay = {
  heading: string;
  /** 日の印（`2026-10-25`。タブのキー） */
  day: string;
  trails: IssueTrail[];
  /** その日に出来事があった Issue の数 */
  count: number;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の暦日（`2026-10-25`） */
export function jstDay(at: string): string {
  return new Date(Date.parse(at) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 同じ日の出来事を Issue ごとにまとめ、新しい出来事がある Issue を上に */
export function groupTrails(events: TrailEvent[]): IssueTrail[] {
  const map = new Map<string, IssueTrail>();
  for (const event of events) {
    const key = `${event.issue.owner}/${event.issue.repo}#${event.issue.number}`;
    let trail = map.get(key);
    if (!trail) {
      trail = { key, issue: event.issue, steps: [], latestAt: event.at };
      map.set(key, trail);
    }
    trail.steps.push({
      id: event.id,
      at: event.at,
      time: formatEventTime(event.at),
      short: event.short,
      tone: event.tone,
    });
    if (event.at > trail.latestAt) trail.latestAt = event.at;
  }
  const trails = [...map.values()];
  for (const trail of trails) trail.steps.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return trails.sort((a, b) => b.latestAt.localeCompare(a.latestAt) || a.key.localeCompare(b.key));
}

/** 出来事を日ごとに分け（新しい日が先）、それぞれ Issue ごとにまとめる。最大3日 */
export function groupTrailDays(events: TrailEvent[], now: Date): TrailDay[] {
  const byDay = new Map<string, TrailEvent[]>();
  for (const event of events) {
    const day = jstDay(event.at);
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 3)
    .map(([day, list]) => {
      const trails = groupTrails(list);
      return { heading: dayHeading(list[0].at, now), day, trails, count: trails.length };
    });
}
