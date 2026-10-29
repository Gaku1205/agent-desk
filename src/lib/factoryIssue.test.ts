import { describe, expect, it } from "vitest";
import { isFactoryIssue } from "./factoryIssue";

describe("isFactoryIssue", () => {
  it("テンプレートの「新サービス：」（全角コロン）は当たる", () => {
    expect(isFactoryIssue("新サービス：家計簿", true)).toBe(true);
  });

  it("半角コロンも当たる", () => {
    expect(isFactoryIssue("新サービス:家計簿", true)).toBe(true);
  });

  it("テンプレートでないリポジトリは当たらない", () => {
    expect(isFactoryIssue("新サービス：家計簿", false)).toBe(false);
  });

  it("is_template が不明なら当たらない", () => {
    expect(isFactoryIssue("新サービス：家計簿", undefined)).toBe(false);
  });

  it("「新サービス」で始まらないタイトルは当たらない", () => {
    expect(isFactoryIssue("ボタンを直す", true)).toBe(false);
    expect(isFactoryIssue("【新サービス：家計簿】", true)).toBe(false);
    expect(isFactoryIssue("新サービスの案", true)).toBe(false);
  });

  it("閉じたIssueは当たらない", () => {
    expect(isFactoryIssue("新サービス：家計簿", true, "closed")).toBe(false);
  });
});
