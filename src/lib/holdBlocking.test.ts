import { describe, expect, it } from "vitest";
import { holdBlockingNote, parseHoldBlocking } from "./holdBlocking";

let id = 1;
function comment(body: string, createdAt: string, author = "github-actions[bot]", issueNumber = 40) {
  return { id: id++, issueNumber, author, body, createdAt };
}

describe("parseHoldBlocking", () => {
  it("印から番号を読む", () => {
    expect(parseHoldBlocking([comment("<!-- hold-blocking: #12 -->", "2026-11-17T01:00:00Z")], 40)).toEqual([12]);
  });

  it("複数の番号を全部取る（同じ番号は1つ）", () => {
    const c = comment("説明\n<!-- hold-blocking: #12,#15, #12 -->", "2026-11-17T01:00:00Z");
    expect(parseHoldBlocking([c], 40)).toEqual([12, 15]);
  });

  it("印が無いときは空", () => {
    expect(parseHoldBlocking([comment("ふつうのコメント", "2026-11-17T01:00:00Z")], 40)).toEqual([]);
    expect(parseHoldBlocking([], 40)).toEqual([]);
  });

  it("形が壊れている・数字が読めないときは空", () => {
    expect(parseHoldBlocking([comment("<!-- hold-blocking: -->", "2026-11-17T01:00:00Z")], 40)).toEqual([]);
    expect(parseHoldBlocking([comment("<!-- hold-blocking: abc, 12 -->", "2026-11-17T01:00:00Z")], 40)).toEqual([]);
    expect(parseHoldBlocking([comment("<!-- hold-blocking: #12", "2026-11-17T01:00:00Z")], 40)).toEqual([]);
  });

  it("最新の印を使う（新しい印が空なら、古い印は使わない）", () => {
    const old = comment("<!-- hold-blocking: #12 -->", "2026-11-17T01:00:00Z");
    const next = comment("<!-- hold-blocking: #15 -->", "2026-11-17T02:00:00Z");
    expect(parseHoldBlocking([next, old], 40)).toEqual([15]);
    const empty = comment("<!-- hold-blocking: -->", "2026-11-17T03:00:00Z");
    expect(parseHoldBlocking([old, next, empty], 40)).toEqual([]);
  });

  it("作者が人のコメント・別のPRのコメントは使わない", () => {
    const human = comment("<!-- hold-blocking: #12 -->", "2026-11-17T01:00:00Z", "Gaku1205");
    const other = comment("<!-- hold-blocking: #13 -->", "2026-11-17T01:00:00Z", "github-actions[bot]", 41);
    expect(parseHoldBlocking([human, other], 40)).toEqual([]);
  });
});

describe("holdBlockingNote", () => {
  const issues = [
    { number: 12, title: "一覧を週ごとに分ける" },
    { number: 15, title: "並べ替えを保存する" },
  ];

  it("題名つきで1行にする", () => {
    expect(holdBlockingNote([12], issues)).toBe("マージすると #12（一覧を週ごとに分ける）が動き出します");
    expect(holdBlockingNote([12, 15], issues)).toBe(
      "マージすると #12（一覧を週ごとに分ける）・#15（並べ替えを保存する）が動き出します",
    );
  });

  it("題名が見つからない番号は番号だけ", () => {
    expect(holdBlockingNote([12, 99], issues)).toBe("マージすると #12（一覧を週ごとに分ける）・#99が動き出します");
  });

  it("番号が無ければ null", () => {
    expect(holdBlockingNote([], issues)).toBeNull();
  });
});
