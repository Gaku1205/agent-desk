import { describe, expect, it } from "vitest";
import { fixLabel, getFlowBranch } from "./flowBranch";

describe("getFlowBranch", () => {
  it("CIが失敗していなければ分岐は無い", () => {
    expect(getFlowBranch({ ci: "none", fixCount: 0 })).toBeNull();
    expect(getFlowBranch({ ci: "running", fixCount: 0 })).toBeNull();
    expect(getFlowBranch({ ci: "passed", fixCount: 0 })).toBeNull();
  });

  it("CI失敗（修正の前）：枠が開き、修正1回目が走り、戻る線が付く", () => {
    expect(getFlowBranch({ ci: "failed", fixCount: 0 })).toEqual({
      n: 1,
      fixState: "running",
      branch: "active",
      returnLine: true,
    });
  });

  it("修正の依頼が出て直している間は、その回数", () => {
    expect(getFlowBranch({ ci: "failed", fixCount: 1, fixing: true })?.n).toBe(1);
    expect(getFlowBranch({ ci: "failed", fixCount: 2, fixing: true })?.n).toBe(2);
  });

  it("直したあとにまたCIが失敗したら、次の回数", () => {
    expect(getFlowBranch({ ci: "failed", fixCount: 1 })?.n).toBe(2);
    expect(getFlowBranch({ ci: "failed", fixCount: 2 })).toMatchObject({ n: 3, fixState: "running" });
  });

  it("直したあとのCI中：修正は成功で、枝はまだ生きている", () => {
    expect(getFlowBranch({ ci: "running", fixCount: 2 })).toEqual({
      n: 2,
      fixState: "done",
      branch: "active",
      returnLine: true,
    });
  });

  it("3回直してもCIが失敗：最後のブロックを失敗にして止める", () => {
    expect(getFlowBranch({ ci: "failed", fixCount: 3 })).toEqual({
      n: 3,
      fixState: "failed",
      branch: "active",
      returnLine: true,
    });
    expect(getFlowBranch({ ci: "failed", fixCount: 9 })?.n).toBe(3);
  });

  it("CIが通ったら、通らなかった枝（失敗したCIと修正）になる", () => {
    for (const n of [1, 2, 3]) {
      expect(getFlowBranch({ ci: "passed", fixCount: n })).toEqual({
        n,
        fixState: "done",
        branch: "notTaken",
        returnLine: true,
      });
    }
  });

  it("止まったときは修正ブロックを失敗にする", () => {
    expect(getFlowBranch({ ci: "failed", fixCount: 0, stuck: true })?.fixState).toBe("failed");
  });

  it("文は「修正 n回目 / 3」", () => {
    expect(fixLabel(2)).toBe("修正 2回目 / 3");
  });
});
