import { describe, expect, it } from "vitest";
import { changedRepos, formatSaveFailures, sameEvents, type NotifyDraft } from "./notifyChanges";

const draft = (over: Partial<NotifyDraft>): NotifyDraft => ({
  name: "o/a",
  pipeline: true,
  saved: ["stuck"],
  current: ["stuck"],
  ...over,
});

describe("sameEvents", () => {
  it("順番が違っても同じ集まりなら同じ", () => {
    expect(sameEvents(["stuck", "question"], ["question", "stuck"])).toBe(true);
  });
  it("違う集まりなら違う", () => {
    expect(sameEvents(["stuck"], [])).toBe(false);
  });
});

describe("changedRepos", () => {
  it("変更が無ければ空", () => {
    expect(changedRepos([draft({})])).toEqual([]);
  });
  it("変わったリポジトリだけ返す", () => {
    const changed = draft({ name: "o/b", current: [] });
    expect(changedRepos([draft({}), changed])).toEqual([changed]);
  });
  it("パイプラインが無い列は返さない", () => {
    expect(changedRepos([draft({ pipeline: false, current: [] })])).toEqual([]);
  });
});

describe("formatSaveFailures", () => {
  it("失敗が無ければ空", () => {
    expect(formatSaveFailures([], 2)).toBe("");
  });
  it("1つだけ保存しようとして失敗したら理由だけ", () => {
    expect(formatSaveFailures([{ name: "o/a", message: "失敗" }], 1)).toBe("失敗");
  });
  it("複数のときはリポジトリ名を付ける", () => {
    expect(
      formatSaveFailures(
        [
          { name: "o/a", message: "A" },
          { name: "o/b", message: "B" },
        ],
        3,
      ),
    ).toBe("o/a：A / o/b：B");
  });
});
