import { describe, expect, it } from "vitest";
import type { RepoData } from "./github/types";
import { formatStaleTime, isEmptyRepoData, oldestReadAt, shouldHoldPrevious, shouldRememberSnapshot } from "./staleSnapshot";

const issue = {
  number: 1,
  title: "t",
  body: "",
  state: "open" as const,
  labels: ["ai:queue"],
  url: "u",
  createdAt: "2026-11-19T00:00:00Z",
  updatedAt: "2026-11-19T00:00:00Z",
  closedAt: null,
};
const empty: RepoData = { issues: [], pulls: [], comments: [], pullChecks: {}, events: [] };
const full: RepoData = { ...empty, issues: [issue] };

describe("shouldRememberSnapshot", () => {
  it("中身のある読みは覚える", () => {
    expect(shouldRememberSnapshot(null, full)).toBe(true);
    expect(shouldRememberSnapshot(full, full)).toBe(true);
  });
  it("空の読みは、覚えている物が空でないとき上書きしない", () => {
    expect(shouldRememberSnapshot(full, empty)).toBe(false);
  });
  it("空の読みは、覚えている物が無いとき覚えない", () => {
    expect(shouldRememberSnapshot(null, empty)).toBe(false);
  });
  it("本当に0件のリポジトリは、覚えている物も空なら書き直す", () => {
    expect(shouldRememberSnapshot(empty, empty)).toBe(true);
  });
  it("取り直しの途中の段（古い・一部だけ）は描かず、そろうまで前の中身を出す（行が減って見えない）", () => {
    type V = { rows: number; complete: boolean };
    const isFinal = (v: V) => v.complete;
    // 開いたまま3回取り直す。各回の段：空 → 一部 → そろった
    const refreshes: V[][] = [0, 1, 2].map(() => [
      { rows: 0, complete: false },
      { rows: 2, complete: false },
      { rows: 5, complete: true },
    ]);
    let shown: { first: unknown; value: V } = { first: "initial", value: { rows: 5, complete: true } };
    const seen: number[] = [shown.value.rows];
    refreshes.forEach((steps, i) => {
      const first = `refresh-${i}`;
      for (const step of steps) {
        const hold = shouldHoldPrevious(shown.first, first, step, isFinal);
        if (!hold) shown = { first, value: step };
        seen.push(shown.value.rows);
      }
    });
    expect(Math.min(...seen)).toBe(5);
  });

  it("formatStaleTime は日本時間の HH:MM", () => {
    expect(formatStaleTime("2026-11-19T02:05:30Z")).toBe("11:05");
    expect(formatStaleTime("bad")).toBeNull();
  });

  it("oldestReadAt は読んだ時刻のうちいちばん古い物", () => {
    const d = (readAt: string) => ({ ...full, sync: { mode: "full" as const, readAt, fullAt: readAt, count: 1 } });
    expect(
      oldestReadAt([{ data: d("2026-11-19T02:05:00Z") }, { data: d("2026-11-19T01:00:00Z") }]),
    ).toBe("2026-11-19T01:00:00Z");
    expect(oldestReadAt([])).toBeNull();
  });

  it("isEmptyRepoData", () => {
    expect(isEmptyRepoData(empty)).toBe(true);
    expect(isEmptyRepoData(full)).toBe(false);
  });
});
