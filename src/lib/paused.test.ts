import { describe, expect, it } from "vitest";
import type { CommentData } from "./github/types";
import { parsePausedMark, pausedMark, pausedReason } from "./paused";

function comment(body: string, author: string, createdAt: string, issueNumber = 5): CommentData {
  return { id: Math.floor(Math.random() * 1e9), issueNumber, author, body, createdAt };
}

describe("pausedReason", () => {
  it("1行目の印から理由を取る", () => {
    expect(pausedReason("<!-- paused: PR #510 のマージ待ち -->\n説明")).toBe("PR #510 のマージ待ち");
    expect(pausedReason("  <!--paused:計測中-->")).toBe("計測中");
  });

  it("1行目でなければ読まない・理由が空なら読まない", () => {
    expect(pausedReason("説明\n<!-- paused: 理由 -->")).toBeNull();
    expect(pausedReason("<!-- paused: -->")).toBeNull();
    expect(pausedReason("<!-- paused: 理由 --> あと")).toBeNull();
  });
});

describe("parsePausedMark", () => {
  it("オーナーかAppが書いた印を読む", () => {
    const a = parsePausedMark([comment("<!-- paused: A -->", "Owner", "2026-11-18T10:00:00Z")], 5, "owner");
    expect(a).toEqual({ reason: "A", at: "2026-11-18T10:00:00Z" });
    const b = parsePausedMark([comment("<!-- paused: B -->", "claude[bot]", "2026-11-18T10:00:00Z")], 5, "owner");
    expect(b?.reason).toBe("B");
  });

  it("ほかの人が書いた印は無視する", () => {
    expect(parsePausedMark([comment("<!-- paused: X -->", "stranger", "2026-11-18T10:00:00Z")], 5, "owner")).toBeNull();
  });

  it("ほかのIssueの印は読まない", () => {
    expect(parsePausedMark([comment("<!-- paused: X -->", "owner", "2026-11-18T10:00:00Z", 6)], 5, "owner")).toBeNull();
  });

  it("複数あれば、いちばん新しい物を使う", () => {
    const mark = parsePausedMark(
      [
        comment("<!-- paused: 古い -->", "owner", "2026-11-18T09:00:00Z"),
        comment("<!-- paused: 新しい -->", "owner", "2026-11-18T11:00:00Z"),
        comment("<!-- paused: 他人 -->", "stranger", "2026-11-18T12:00:00Z"),
      ],
      5,
      "owner",
    );
    expect(mark).toEqual({ reason: "新しい", at: "2026-11-18T11:00:00Z" });
  });

  it("印が無ければ null", () => {
    expect(parsePausedMark([comment("ふつうのコメント", "owner", "2026-11-18T09:00:00Z")], 5, "owner")).toBeNull();
  });
});

describe("pausedMark", () => {
  const comments = [comment("<!-- paused: 待ち -->", "owner", "2026-11-18T09:00:00Z")];

  it("ai:skip が付いた開いたIssueだけ出す", () => {
    expect(pausedMark({ number: 5, state: "open", labels: ["ai:skip"] }, comments, "owner")?.reason).toBe("待ち");
  });

  it("ai:skip が外れたら、印があっても出さない", () => {
    expect(pausedMark({ number: 5, state: "open", labels: [] }, comments, "owner")).toBeNull();
  });

  it("閉じたIssueは出さない", () => {
    expect(pausedMark({ number: 5, state: "closed", labels: ["ai:skip"] }, comments, "owner")).toBeNull();
  });

  it("印が無い ai:skip は出さない（今までどおり On hold）", () => {
    expect(pausedMark({ number: 5, state: "open", labels: ["ai:skip"] }, [], "owner")).toBeNull();
  });
});
