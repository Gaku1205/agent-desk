import { describe, expect, it } from "vitest";
import { toWorkflowRun } from "./fetch";

const base = { status: "in_progress", updated_at: "2026-11-18T08:00:00Z" };

describe("toWorkflowRun（終わり方）", () => {
  it("conclusion を読む。null・文字でないときは持たない", () => {
    expect(toWorkflowRun({ ...base, status: "completed", conclusion: "cancelled" })?.conclusion).toBe("cancelled");
    expect(toWorkflowRun({ ...base, conclusion: null })).not.toHaveProperty("conclusion");
  });
});

describe("toWorkflowRun（名前と始まった時刻）", () => {
  it("run_started_at があればそれを startedAt に使う", () => {
    const run = toWorkflowRun({
      ...base,
      run_started_at: "2026-11-18T07:00:00Z",
      created_at: "2026-11-18T06:00:00Z",
    });
    expect(run?.startedAt).toBe("2026-11-18T07:00:00Z");
  });

  it("run_started_at が無い・読めないときは created_at に戻る", () => {
    expect(toWorkflowRun({ ...base, created_at: "2026-11-18T06:00:00Z" })?.startedAt).toBe(
      "2026-11-18T06:00:00Z",
    );
    expect(
      toWorkflowRun({ ...base, run_started_at: "xxx", created_at: "2026-11-18T06:00:00Z" })?.startedAt,
    ).toBe("2026-11-18T06:00:00Z");
  });

  it("どちらも無ければ startedAt を持たない", () => {
    const run = toWorkflowRun(base);
    expect(run).not.toBeNull();
    expect(run).not.toHaveProperty("startedAt");
  });

  it("name は前後の空白を除き、空白だけなら持たない", () => {
    expect(toWorkflowRun({ ...base, name: "  Claude  " })?.name).toBe("Claude");
    const blank = toWorkflowRun({ ...base, name: "   " });
    expect(blank).not.toBeNull();
    expect(blank).not.toHaveProperty("name");
  });
});
