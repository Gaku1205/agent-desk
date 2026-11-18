import { describe, expect, it } from "vitest";
import type { RepoResult } from "./github/types";
import { loadErrorsOf } from "./loadErrors";

describe("読めなかったリポジトリ", () => {
  const ok = { owner: "o", repo: "fine", ok: true, data: {} } as unknown as RepoResult;
  const failed = (repo: string, message: string) =>
    ({ owner: "o", repo, ok: false, error: { kind: "rate_limited", message } }) as unknown as RepoResult;

  it("読めた物は入れず、読めなかった物だけを `owner/repo` と理由にする", () => {
    expect(loadErrorsOf([ok, failed("a", "レート制限"), ok, failed("b", "権限がありません")])).toEqual([
      { repo: "o/a", message: "レート制限" },
      { repo: "o/b", message: "権限がありません" },
    ]);
  });

  it("全部読めていれば空", () => {
    expect(loadErrorsOf([ok, ok])).toEqual([]);
    expect(loadErrorsOf([])).toEqual([]);
  });
});
