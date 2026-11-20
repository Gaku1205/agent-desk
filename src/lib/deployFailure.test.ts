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

  describe("あとの公開で解決ずみの物", () => {
    const mergedAt = "2026-11-19T10:00:00Z";
    const vercel = status("Vercel", "failure", mergedAt, "Account is blocked.");
    const supabase = status("deploy/supabase", "failure", mergedAt, "表の変更を流せませんでした");

    it("後の Vercel の成功があれば、Vercel だけの失敗は出さない", () => {
      expect(deployFailureReason([vercel], { mergedAt, mainDeployed: { Vercel: "2026-11-20T10:00:00Z" } })).toBeNull();
    });

    it("Vercel と supabase が両方失敗なら、supabase だけが残る", () => {
      expect(
        deployFailureReason([vercel, supabase], { mergedAt, mainDeployed: { "Vercel – app": "2026-11-20T10:00:00Z" } }),
      ).toBe("supabase：表の変更を流せませんでした");
    });

    it("supabase は後の Vercel の成功では解決しない", () => {
      expect(
        deployFailureReason([supabase], { mergedAt, mainDeployed: { Vercel: "2026-11-20T10:00:00Z" } }),
      ).toBe("supabase：表の変更を流せませんでした");
    });

    it("成功がマージより前なら Vercel の失敗は残る", () => {
      expect(deployFailureReason([vercel], { mergedAt, mainDeployed: { Vercel: "2026-11-18T10:00:00Z" } })).toBe(
        "Account is blocked.",
      );
    });
  });
});
