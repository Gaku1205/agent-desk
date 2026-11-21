import { describe, expect, it } from "vitest";
import { awaySummary, parseLastSeen, type AwayEvent, type AwayTurn } from "./awaySummary";

const NOW = new Date("2026-11-21T06:58:00Z");
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3600_000).toISOString();

function deployed(number: number, title: string, at: string): AwayEvent {
  return { id: `o/r#${number}:deployed`, at, issue: { owner: "o", repo: "r", number, title } };
}
function stuck(number: number, at: string): AwayEvent {
  return { id: `o/r#${number}:stuck-99`, at, issue: { owner: "o", repo: "r", number, title: "t" } };
}
function turn(number: number, stage: string, waitingSince: string): AwayTurn {
  return { owner: "o", repo: "r", issue: { number }, status: { stage }, waitingSince };
}

describe("awaySummary", () => {
  const events = [deployed(700, "渡す物を細くした", hoursAgo(3))];

  it("2時間の境目：ちょうど2時間は出し、1分足りなければ出さない", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const e = [deployed(1, "a", at(60_000))];
    expect(awaySummary(at(2 * 3600_000), NOW, e, [])).not.toBeNull();
    expect(awaySummary(at(2 * 3600_000 - 60_000), NOW, e, [])).toBeNull();
  });

  it("前に見た時刻が無い・読めない・未来のときは出さない", () => {
    expect(awaySummary(null, NOW, events, [])).toBeNull();
    expect(awaySummary("きのう", NOW, events, [])).toBeNull();
    expect(awaySummary(hoursAgo(-1), NOW, events, [])).toBeNull();
    expect(parseLastSeen("", NOW)).toBeNull();
  });

  it("何時間ぶりかは切り捨て", () => {
    expect(awaySummary(hoursAgo(7.9), NOW, events, [])?.hours).toBe(7);
  });

  it("前に見た時刻より後の公開・止まり・新しい質問だけ数える", () => {
    const result = awaySummary(
      hoursAgo(7),
      NOW,
      [
        deployed(1, "a", hoursAgo(1)),
        deployed(2, "b", hoursAgo(2)),
        deployed(3, "古い", hoursAgo(8)),
        stuck(4, hoursAgo(5)),
        stuck(5, hoursAgo(9)),
      ],
      [turn(6, "question", hoursAgo(3)), turn(7, "question", hoursAgo(10)), turn(8, "mergeWaiting", hoursAgo(1))],
    );
    expect(result).toMatchObject({ hours: 7, deployed: 2, stuck: 1, questions: 1 });
  });

  it("止まった物が今は止まりでなければ自動で直った", () => {
    expect(awaySummary(hoursAgo(7), NOW, [stuck(4, hoursAgo(5))], [])?.stuckRecovered).toBe(true);
    expect(awaySummary(hoursAgo(7), NOW, [stuck(4, hoursAgo(5))], [turn(4, "stuck", hoursAgo(5))])?.stuckRecovered).toBe(false);
  });

  it("題名は新しい順に2つ、残りは ほか N", () => {
    const result = awaySummary(
      hoursAgo(7),
      NOW,
      [deployed(1, "a", hoursAgo(5)), deployed(2, "b", hoursAgo(4)), deployed(3, "c", hoursAgo(3)), deployed(4, "d", hoursAgo(2))],
      [],
    );
    expect(result?.titles).toEqual(["#4 d", "#3 c"]);
    expect(result?.more).toBe(2);
  });

  it("全部0件なら出さない", () => {
    expect(awaySummary(hoursAgo(7), NOW, [deployed(1, "古い", hoursAgo(9))], [])).toBeNull();
  });
});
