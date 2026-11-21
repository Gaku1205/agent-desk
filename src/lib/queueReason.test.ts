import { describe, expect, it } from "vitest";
import type { CommentData } from "./github/types";
import { afterText, blockedByLabel, openBlockedBy, parseBlockedBy, queueHeadText } from "./queueReason";

function comment(issueNumber: number, body: string, id = 1): CommentData {
  return { id, issueNumber, author: "claude[bot]", body, createdAt: "2026-11-21T01:00:00Z" };
}

const here = { owner: "o", repo: "r" };
const open = { issues: [], pulls: [] };

describe("parseBlockedBy", () => {
  it("印が1つ", () => {
    expect(parseBlockedBy([comment(9, "<!-- blocked-by: o/r#715 -->")], 9)).toEqual([{ owner: "o", repo: "r", number: 715 }]);
  });

  it("複数（別のコメントでも）・別のリポジトリ・同じ相手は1つ・ほかの Issue の印は読まない", () => {
    const comments = [
      comment(9, "<!-- blocked-by: o/r#715 -->\n<!-- blocked-by: o/other#3 -->", 1),
      comment(9, "<!-- blocked-by: o/r#715 -->", 2),
      comment(10, "<!-- blocked-by: o/r#99 -->", 3),
    ];
    expect(parseBlockedBy(comments, 9)).toEqual([
      { owner: "o", repo: "r", number: 715 },
      { owner: "o", repo: "other", number: 3 },
    ]);
  });

  it("印が無ければ空", () => {
    expect(parseBlockedBy([comment(9, "#715 が終わってから始めます")], 9)).toEqual([]);
  });
});

describe("openBlockedBy", () => {
  const marks = [
    { owner: "o", repo: "r", number: 1 },
    { owner: "o", repo: "r", number: 2 },
    { owner: "o", repo: "r", number: 3 },
    { owner: "o", repo: "other", number: 4 },
  ];
  it("閉じた Issue・マージ済みの PR は外す。取れない物と別のリポジトリは残す", () => {
    const data = {
      issues: [{ number: 1, state: "closed" }, { number: 2, state: "open" }],
      pulls: [{ number: 3, state: "closed", merged: true }],
    } as unknown as Parameters<typeof openBlockedBy>[2];
    expect(openBlockedBy(marks, here, data).map((m) => m.number)).toEqual([2, 4]);
    expect(openBlockedBy(marks, here, open).length).toBe(4);
  });
});

describe("書き方", () => {
  it("同じリポジトリは #番号、別のリポジトリは リポジトリ#番号", () => {
    expect(blockedByLabel({ owner: "o", repo: "r", number: 715 }, here)).toBe("#715");
    expect(blockedByLabel({ owner: "o", repo: "other", number: 3 }, here)).toBe("other#3");
    expect(afterText(["#715"])).toBe("#715 のあと");
    expect(afterText(["#1", "#2"])).toBe("#1 + #2 のあと");
  });
});

describe("queueHeadText（ホームの順番待ちのかっこの中）", () => {
  const row = (number: number, extra: Partial<Parameters<typeof queueHeadText>[0][number]> = {}) => ({
    repo: "agent-desk",
    number,
    blocked: false,
    waitAfter: undefined,
    note: null,
    ...extra,
  });

  it("ai:queue があれば、その先頭を `次：` に出す", () => {
    expect(queueHeadText([row(716, { blocked: true, waitAfter: ["#715"] }), row(720)], false)).toBe("次：#720");
    expect(queueHeadText([row(720)], true)).toBe("次：agent-desk#720");
  });

  it("ai:blocked だけなら `次：` と出さず、`#715 のあと`", () => {
    expect(queueHeadText([row(716, { blocked: true, waitAfter: ["#715"] }), row(717, { blocked: true })], false)).toBe("#715 のあと");
    expect(queueHeadText([row(716, { blocked: true, waitAfter: ["#1", "#2"] })], false)).toBe("#1 + #2 のあと");
  });

  it("印が無ければ、理由の文の番号から", () => {
    expect(queueHeadText([row(716, { blocked: true, note: "#715 が終わるまで" })], false)).toBe("#715 のあと");
  });
});
