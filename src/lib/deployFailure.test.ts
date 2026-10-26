import { describe, expect, it } from "vitest";
import { deployFailureMessage, deployFailureReason } from "./deployFailure";

const status = (context: string, state: string, updatedAt: string, description: string) => ({
  context,
  state,
  updatedAt,
  description,
});

describe("deployFailureMessage", () => {
  it("上限（時間・分・日）を日本語にする", () => {
    expect(deployFailureMessage("Deployment rate limited — retry in 24 hours.")).toBe(
      "利用上限に達しました。あと24時間で再開します",
    );
    expect(deployFailureMessage("Deployment rate limited — retry in 30 minutes.")).toBe(
      "利用上限に達しました。あと30分で再開します",
    );
    expect(deployFailureMessage("Deployment rate limited — retry in 1 day.")).toBe(
      "利用上限に達しました。あと1日で再開します",
    );
  });

  it("それ以外はそのまま出す", () => {
    expect(deployFailureMessage("Build failed")).toBe("Build failed");
  });

  it("空なら null", () => {
    expect(deployFailureMessage("")).toBeNull();
    expect(deployFailureMessage("  ")).toBeNull();
  });
});

describe("deployFailureReason", () => {
  it("failure・error のうち updatedAt が最新の description を使う", () => {
    const reason = deployFailureReason([
      status("Vercel", "failure", "2026-10-25T10:00:00Z", "古い"),
      status("Vercel – app", "error", "2026-10-25T11:00:00Z", "新しい"),
      status("Vercel", "success", "2026-10-25T12:00:00Z", "成功"),
    ]);
    expect(reason).toBe("新しい");
  });

  it("Vercel 以外や失敗以外は見ない", () => {
    expect(deployFailureReason([status("ci", "failure", "2026-10-25T10:00:00Z", "x")])).toBeNull();
    expect(deployFailureReason([status("Vercel", "pending", "2026-10-25T10:00:00Z", "x")])).toBeNull();
    expect(deployFailureReason([])).toBeNull();
  });

  it("description が空なら null", () => {
    expect(deployFailureReason([status("Vercel", "failure", "2026-10-25T10:00:00Z", "")])).toBeNull();
  });
});
