import { describe, expect, it } from "vitest";
import { isPipelineMaintenanceIssue } from "./pipelineIssue";

const base = { title: "状態の判定", body: "", labels: [] as string[] };

describe("isPipelineMaintenanceIssue", () => {
  it("ラベル pipeline があれば true", () => {
    expect(isPipelineMaintenanceIssue({ ...base, labels: ["ai:skip", "pipeline"] })).toBe(true);
  });

  it("本文に印があれば true", () => {
    expect(isPipelineMaintenanceIssue({ ...base, body: "説明\n<!-- pipeline-maintenance -->" })).toBe(true);
  });

  it("題名が「AIの許可が足りない：」で始まれば true", () => {
    expect(isPipelineMaintenanceIssue({ ...base, title: "AIの許可が足りない：Bash(npm test)" })).toBe(true);
  });

  it("どれにも当てはまらなければ false（ai:skip だけ・半角コロン・題名の途中）", () => {
    expect(isPipelineMaintenanceIssue({ ...base, labels: ["ai:skip"] })).toBe(false);
    expect(isPipelineMaintenanceIssue({ ...base, title: "AIの許可が足りない:x" })).toBe(false);
    expect(isPipelineMaintenanceIssue({ ...base, title: "メモ AIの許可が足りない：x" })).toBe(false);
  });
});
