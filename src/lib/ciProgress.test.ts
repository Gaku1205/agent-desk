import { describe, expect, it } from "vitest";
import { ciKindOf, ciProgress, ciStepText, countCiChecks } from "./ciProgress";

const run = (status: string, conclusion: string | null = null) => ({ status, conclusion });

describe("ciKindOf・countCiChecks", () => {
  it("通過は success・neutral・skipped、ほかの完了は失敗", () => {
    expect(ciKindOf(run("completed", "success"))).toBe("passed");
    expect(ciKindOf(run("completed", "neutral"))).toBe("passed");
    expect(ciKindOf(run("completed", "skipped"))).toBe("passed");
    for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "stale", null]) {
      expect(ciKindOf(run("completed", conclusion))).toBe("failed");
    }
  });

  it("in_progress は実行中、queued・waiting・pending は枠待ち", () => {
    expect(ciKindOf(run("in_progress"))).toBe("running");
    expect(ciKindOf(run("queued"))).toBe("queued");
    expect(ciKindOf(run("waiting"))).toBe("queued");
    expect(ciKindOf(run("pending"))).toBe("queued");
  });

  it("種類ごとに数える", () => {
    expect(
      countCiChecks([run("completed", "success"), run("in_progress"), run("queued"), run("queued"), run("completed", "failure")]),
    ).toEqual({ passed: 1, running: 1, queued: 2, failed: 1, total: 5 });
  });
});

describe("ciProgress", () => {
  it("全部通過：線は通過だけ、言葉は実行中", () => {
    const p = ciProgress({ passed: 7, total: 7, running: 0, queued: 0, failed: 0 });
    expect(p.segments).toEqual([{ kind: "passed", count: 7, ratio: 1 }]);
    expect(p.marks).toBe("✓7");
    expect(p.word).toBe("実行中");
    expect(p.label).toBe("CI 7件のうち 通過7件");
  });

  it("枠待ちあり：`✓4 ⧗6 枠待ち`", () => {
    const p = ciProgress({ passed: 4, total: 10, running: 0, queued: 6, failed: 0 });
    expect(p.segments.map((s) => [s.kind, s.ratio])).toEqual([
      ["passed", 0.4],
      ["queued", 0.6],
    ]);
    expect(ciStepText(3, 7, p)).toBe("4/7 CI ✓4 ⧗6 枠待ち");
    expect(p.label).toBe("CI 10件のうち 通過4件・枠待ち6件");
  });

  it("実行中あり：`✓7 ◌3 実行中`", () => {
    const p = ciProgress({ passed: 7, total: 10, running: 3, queued: 0, failed: 0 });
    expect(ciStepText(3, 7, p)).toBe("4/7 CI ✓7 ◌3 実行中");
    expect(p.label).toBe("CI 10件のうち 通過7件・実行中3件");
  });

  it("失敗あり：言葉は失敗（枠待ちがあっても）。並びは 通過・実行中・枠待ち・失敗", () => {
    const p = ciProgress({ passed: 8, total: 10, running: 1, queued: 0, failed: 1 });
    expect(ciStepText(3, 7, p)).toBe("4/7 CI ✓8 ◌1 ×1 失敗");
    const mixed = ciProgress({ passed: 1, total: 4, running: 1, queued: 1, failed: 1 });
    expect(mixed.segments.map((s) => s.kind)).toEqual(["passed", "running", "queued", "failed"]);
    expect(mixed.word).toBe("失敗");
    expect(mixed.label).toBe("CI 4件のうち 通過1件・実行中1件・枠待ち1件・失敗1件");
  });

  it("0件：線のまとまりも記号の数も無い", () => {
    const p = ciProgress({ passed: 0, total: 0, running: 0, queued: 0, failed: 0 });
    expect(p.segments).toEqual([]);
    expect(p.marks).toBe("");
    expect(ciStepText(3, 7, p)).toBe("4/7 CI 実行中");
    expect(p.label).toBe("CI のチェックはまだありません");
  });

  it("内訳の無い古い形は、残りを実行中とみなす", () => {
    const p = ciProgress({ passed: 2, total: 5 });
    expect(p.counts).toEqual({ passed: 2, running: 3, queued: 0, failed: 0, total: 5 });
  });
});
