import { describe, expect, it } from "vitest";
import { chooseIssueRepo, newIssueHref } from "./issueRepo";

const names = ["o/a", "o/b", "o/c"];

describe("chooseIssueRepo", () => {
  it("リポジトリのページでは、そのリポジトリを選ぶ", () => {
    expect(chooseIssueRepo({ names, pageRepo: "o/b" })).toBe("o/b");
  });

  it("ホームでは先頭", () => {
    expect(chooseIssueRepo({ names })).toBe("o/a");
    expect(chooseIssueRepo({ names, pageRepo: null })).toBe("o/a");
  });

  it("選べない名前（監視していない）が来たら先頭", () => {
    expect(chooseIssueRepo({ names, pageRepo: "x/y" })).toBe("o/a");
  });

  it("大文字小文字は区別せず、一覧の綴りで返す", () => {
    expect(chooseIssueRepo({ names, pageRepo: "O/B" })).toBe("o/b");
  });

  it("手で選んだ物は、同じページにいる間は守る", () => {
    expect(chooseIssueRepo({ names, pageRepo: "o/b", manual: "o/c", manualPage: "o/b" })).toBe("o/c");
  });

  it("ホームで手で選んだ物も、ホームにいる間は守る", () => {
    expect(chooseIssueRepo({ names, manual: "o/c", manualPage: null })).toBe("o/c");
  });

  it("ページが替わったら、手の選びを捨てて移った先に従う", () => {
    expect(chooseIssueRepo({ names, pageRepo: "o/b", manual: "o/c", manualPage: "o/a" })).toBe("o/b");
    expect(chooseIssueRepo({ names, pageRepo: "o/b", manual: "o/c", manualPage: null })).toBe("o/b");
  });

  it("リポジトリのページからホームへ移ったら先頭に戻る", () => {
    expect(chooseIssueRepo({ names, pageRepo: null, manual: "o/c", manualPage: "o/b" })).toBe("o/a");
  });

  it("手で選んだ物が選べない名前なら、ページに従う", () => {
    expect(chooseIssueRepo({ names, pageRepo: "o/b", manual: "x/y", manualPage: "o/b" })).toBe("o/b");
  });

  it("一覧が空なら空文字", () => {
    expect(chooseIssueRepo({ names: [], pageRepo: "o/b" })).toBe("");
  });
});

describe("newIssueHref", () => {
  it("リポジトリのページからは ?repo= を付ける", () => {
    expect(newIssueHref("", { owner: "o", repo: "b" })).toBe("/new?repo=o/b");
  });

  it("デモは /demo を頭に付ける", () => {
    expect(newIssueHref("/demo", { owner: "demo", repo: "todo-app" })).toBe("/demo/new?repo=demo/todo-app");
  });

  it("ホームなどリポジトリのページでないところからは付けない", () => {
    expect(newIssueHref("", null)).toBe("/new");
    expect(newIssueHref("/demo", null)).toBe("/demo/new");
  });
});
