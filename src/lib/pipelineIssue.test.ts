import { describe, expect, it } from "vitest";
import { isPipelineMaintenanceIssue, isPipelineNotice } from "./pipelineIssue";

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

describe("isPipelineNotice", () => {
  const notice = { state: "open" as const, labels: ["ai:skip"], author: "github-actions[bot]" };

  it("パイプラインが作った ai:skip の開いた Issue は true（どちらの作者も）", () => {
    expect(isPipelineNotice(notice)).toBe(true);
    expect(isPipelineNotice({ ...notice, author: "gaku-ai-pipeline[bot]" })).toBe(true);
  });

  it("人間が作った・作った人が取れない ai:skip は false", () => {
    expect(isPipelineNotice({ ...notice, author: "Gaku1205" })).toBe(false);
    expect(isPipelineNotice({ ...notice, author: "claude[bot]" })).toBe(false);
    expect(isPipelineNotice({ state: "open", labels: ["ai:skip"] })).toBe(false);
  });

  it("ai:skip が無い・閉じている Issue は false", () => {
    expect(isPipelineNotice({ ...notice, labels: [] })).toBe(false);
    expect(isPipelineNotice({ ...notice, state: "closed" })).toBe(false);
  });
});
