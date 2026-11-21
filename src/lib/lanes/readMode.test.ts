import { describe, expect, it } from "vitest";
import type { RepoResult } from "../github/types";
import { lanesReadMode } from "./readMode";

const failure = { ok: false, owner: "o", repo: "a" } as unknown as RepoResult;
const success = { ok: true, owner: "o", repo: "b" } as unknown as RepoResult;

describe("lanesReadMode", () => {
  it("全部読めたら ok", () => {
    expect(lanesReadMode({ canSayEmpty: true, sync: "ok", results: [success] })).toBe("ok");
  });

  it("一部だけ読めなかったら partial", () => {
    expect(lanesReadMode({ canSayEmpty: false, sync: "partial", results: [success, failure] })).toBe("partial");
  });

  it("全部読めず、出せる中身も無ければ failed", () => {
    expect(lanesReadMode({ canSayEmpty: false, sync: "failed", results: [failure] })).toBe("failed");
  });

  it("まだ届いていないリポジトリがあれば、中身があっても pending（ok にならない）", () => {
    expect(lanesReadMode({ pendingRepos: 3, canSayEmpty: false, sync: "ok", results: [success] })).toBe("pending");
    expect(lanesReadMode({ pendingRepos: 0, canSayEmpty: true, sync: "ok", results: [success] })).toBe("ok");
  });

  it("全部読めなくても、覚えている結果を出していれば partial", () => {
    expect(lanesReadMode({ canSayEmpty: false, sync: "failed", results: [success] })).toBe("partial");
  });
});
