import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./conversation";
import {
  addedPastText,
  buildPastItems,
  clockTime,
  dayKey,
  dayLabel,
  groupByDay,
  PAST_INITIAL,
  PAST_STEP,
  visibleCount,
  visiblePast,
} from "./pastLog";

// 日本時間 2026-11-17 12:00
const NOW = new Date("2026-11-17T03:00:00.000Z");

const deployed = (key: string, doneAt: string | null, isDeployed = true) =>
  ({ key, deployed: isDeployed, doneAt }) as ChatMessage;

describe("日の見出し", () => {
  it("今日・昨日・それより前は月日", () => {
    expect(dayLabel("2026-11-17T00:20:00.000Z", NOW)).toBe("今日");
    expect(dayLabel("2026-11-16T12:00:00.000Z", NOW)).toBe("昨日");
    expect(dayLabel("2026-11-15T01:10:00.000Z", NOW)).toBe("11月15日");
    expect(dayLabel("2026-01-02T01:10:00.000Z", NOW)).toBe("1月2日");
  });

  it("日の区切りは日本時間（UTCの前日15時が日本の0時）", () => {
    expect(dayLabel("2026-11-16T14:59:00.000Z", NOW)).toBe("昨日");
    expect(dayLabel("2026-11-16T15:00:00.000Z", NOW)).toBe("今日");
    expect(dayKey("2026-11-16T15:00:00.000Z")).toBe("2026-11-17");
  });

  it("時刻は日本時間の HH:mm", () => {
    expect(clockTime("2026-11-17T00:20:00.000Z")).toBe("09:20");
    expect(clockTime("2026-11-16T12:40:00.000Z")).toBe("21:40");
    expect(clockTime("だめ")).toBe("");
  });
});

describe("buildPastItems", () => {
  it("公開済みと監視に追加したお知らせを、時刻の古い順に混ぜる", () => {
    const items = buildPastItems(
      [
        deployed("a/b#2", "2026-11-17T00:20:00.000Z"),
        deployed("a/b#1", "2026-11-15T12:10:00.000Z"),
        deployed("a/b#3", "2026-11-17T01:00:00.000Z", false),
        deployed("a/b#4", null),
      ],
      [{ owner: "gaku", repo: "tochi", at: "2026-11-16T10:00:00.000Z" }],
    );
    expect(items.map((item) => item.key)).toEqual(["a/b#1", "added:gaku/tochi", "a/b#2"]);
  });

  it("同じ時刻はキー順", () => {
    const at = "2026-11-17T00:20:00.000Z";
    expect(buildPastItems([deployed("b#2", at), deployed("a#9", at)], []).map((i) => i.key)).toEqual(["a#9", "b#2"]);
  });

  it("追加のお知らせの文", () => {
    expect(addedPastText("tochi-rirekisho")).toBe("＋ tochi-rirekisho を監視に追加");
  });
});

describe("出す件数（最初の5件・10件ずつ）", () => {
  const items = buildPastItems(
    Array.from({ length: 23 }, (_, i) => deployed(`a#${i + 1}`, new Date(Date.UTC(2026, 10, 1, i)).toISOString())),
    [],
  );

  it("最初は直近5件、読み足すたびに10件、全部を超えない", () => {
    expect(visibleCount(items.length, 0)).toBe(PAST_INITIAL);
    expect(visibleCount(items.length, PAST_STEP)).toBe(15);
    expect(visibleCount(items.length, PAST_STEP * 2)).toBe(23);
    expect(visibleCount(items.length, PAST_STEP * 3)).toBe(23);
    expect(visibleCount(3, 0)).toBe(3);
    expect(visibleCount(0, 0)).toBe(0);
  });

  it("新しい方から数え、古い順のまま返す", () => {
    expect(visiblePast(items, 5).map((i) => i.key)).toEqual(["a#19", "a#20", "a#21", "a#22", "a#23"]);
    expect(visiblePast(items, 0)).toEqual([]);
  });
});

describe("groupByDay", () => {
  it("日ごとに、古い日が先・同じ日は古い順", () => {
    const items = buildPastItems(
      [
        deployed("a#3", "2026-11-17T00:20:00.000Z"),
        deployed("a#1", "2026-11-15T12:10:00.000Z"),
        deployed("a#2", "2026-11-16T13:40:00.000Z"),
        deployed("a#4", "2026-11-17T02:00:00.000Z"),
      ],
      [],
    );
    const days = groupByDay(items, NOW);
    expect(days.map((d) => d.label)).toEqual(["11月15日", "昨日", "今日"]);
    expect(days[2].items.map((i) => i.key)).toEqual(["a#3", "a#4"]);
  });
});
