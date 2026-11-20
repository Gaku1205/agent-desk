import { describe, expect, it } from "vitest";
import { backgroundTitle } from "./backgroundTitle";

const pulls = [{ number: 19, title: "テンプレートの更新を取り込む" }];

describe("backgroundTitle", () => {
  it("マージのコミットの文は、その PR の題名を出す", () => {
    expect(backgroundTitle("Merge pull request #19 from Gaku1205/pipeline-sync/c1015bd", pulls)).toBe(
      "テンプレートの更新を取り込む",
    );
  });
  it("PR の題名が読めないときは、配布の枝なら `パイプラインの更新を取り込む`", () => {
    expect(backgroundTitle("Merge pull request #20 from Gaku1205/pipeline-sync/abc123", pulls)).toBe(
      "パイプラインの更新を取り込む",
    );
  });
  it("PR の題名が読めず、配布の枝でもなければ `#N のマージ`", () => {
    expect(backgroundTitle("Merge pull request #21 from Gaku1205/claude/issue-5-x", pulls)).toBe("#21 のマージ");
  });
  it("PR の題名が空のときも、配布の枝・それ以外の決まりで読み替える", () => {
    const empty = [{ number: 22, title: "  " }];
    expect(backgroundTitle("Merge pull request #22 from o/pipeline-sync/x", empty)).toBe(
      "パイプラインの更新を取り込む",
    );
  });
  it("マージのコミットの文でなければ、そのまま出す（前後の空白は落とす）", () => {
    expect(backgroundTitle("  CI  ", pulls)).toBe("CI");
    expect(backgroundTitle("Watchdog", pulls)).toBe("Watchdog");
  });
  it("空なら null", () => {
    expect(backgroundTitle("   ", pulls)).toBeNull();
  });
});
