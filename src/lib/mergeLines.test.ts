import { describe, expect, it } from "vitest";
import { isMergeWeak, mergeResultLines } from "./mergeLines";

const base = { pullNumber: 19, base: "main", ci: { passed: 4, total: 4 } };

describe("mergeResultLines", () => {
  it("CI・レビュー・公開の3行を、印・名前・結果に分けて返す（空白でそろえない）", () => {
    expect(mergeResultLines({ ...base, review: "clean" })).toEqual([
      { mark: "✓", name: "check", text: "4/4 通過", tone: "ok" },
      { mark: "✓", name: "review", text: "指摘なし", tone: "ok" },
      { mark: "→", name: "deploy", text: "マージ後にVercelが公開", tone: "next" },
    ]);
  });

  it("レビューしていなければ未実施、指摘があれば指摘あり（どちらも失敗の弱い色の行）", () => {
    const pending = mergeResultLines({ ...base, ci: { passed: 3, total: 4 }, review: null })[1];
    expect(pending).toEqual({ mark: "–", name: "review", text: "未実施", tone: "warn" });
    const issues = mergeResultLines({ ...base, review: "issues" })[1];
    expect(issues).toEqual({ mark: "×", name: "review", text: "指摘あり", tone: "warn" });
  });

  it("どの行にも、そろえるための空白が入らない", () => {
    for (const review of ["clean", "issues", null] as const) {
      for (const line of mergeResultLines({ ...base, review })) {
        expect(line.text).not.toMatch(/ {2,}/);
        expect(line.mark).not.toMatch(/\s/);
      }
    }
  });
});

describe("isMergeWeak", () => {
  it("指摘なしのときだけ弱めない", () => {
    expect(isMergeWeak({ ...base, review: "clean" })).toBe(false);
    expect(isMergeWeak({ ...base, review: "issues" })).toBe(true);
    expect(isMergeWeak({ ...base, review: null })).toBe(true);
  });
});
