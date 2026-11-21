import { describe, expect, it } from "vitest";
import { runKindNote } from "./kindNote";

describe("runKindNote", () => {
  it("内部の言葉の種類に、知らない人にも分かる説明を添える", () => {
    expect(runKindNote("Watchdog")).toBe("見張り役：止まった作業が無いか見回っています");
    expect(runKindNote("CI")).toBe("CI（自動のチェック）が動いています");
    expect(runKindNote("Resume")).toBe("時間をおいて、作業を自動でやり直します");
  });

  it("知らない種類（ワークフローの名前のまま）には何も添えない", () => {
    expect(runKindNote("Nightly backup")).toBeNull();
  });
});
