import { describe, expect, it } from "vitest";
import { queueLine, SEAT_LINE, UNKNOWN_LINE } from "./queueLine";
import type { WaitTarget } from "./source";

function target(number: number, running: boolean, kind: WaitTarget["kind"] = "issue"): WaitTarget {
  return { kind, number, title: `作業 ${number}`, running, issueNumber: number, url: `https://x/${number}` };
}

describe("queueLine", () => {
  it("重なり1件は、その相手を出す", () => {
    expect(queueLine({ reasonKind: "overlap", waitFors: [target(550, true)] })).toEqual({
      kind: "target",
      target: target(550, true),
      more: 0,
    });
  });

  it("複数なら、動いている物を先に、次に番号の小さい物。残りは ほか N件", () => {
    const line = queueLine({
      reasonKind: "overlap",
      waitFors: [target(3, false), target(9, true), target(5, true)],
    });
    expect(line).toMatchObject({ kind: "target", more: 2 });
    expect(line.kind === "target" && line.target.number).toBe(5);
  });

  it("動いている物が無ければ番号の小さい物", () => {
    const line = queueLine({ reasonKind: "unknownInflight", waitFors: [target(8, false), target(2, false)] });
    expect(line.kind === "target" && line.target.number).toBe(2);
  });

  it("席待ちは席の文", () => {
    expect(queueLine({ reasonKind: "full", waitFors: [] })).toEqual({ kind: "text", text: SEAT_LINE });
  });

  it("相手が分からないときは分からない文", () => {
    expect(queueLine({ reasonKind: "noTouches", waitFors: [] })).toEqual({ kind: "text", text: UNKNOWN_LINE });
    expect(queueLine({ reasonKind: "blocked", waitFors: [] })).toEqual({ kind: "text", text: UNKNOWN_LINE });
  });
});
