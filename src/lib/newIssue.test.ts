import { describe, expect, it } from "vitest";
import { MAX_ISSUE_IMAGES } from "./issueImages";
import {
  checkNewIssueTitle,
  composeNewIssue,
  MAX_NEW_ISSUE_TITLE,
  NEW_ISSUE_MESSAGES,
  OMAKASE_BODY,
  parseNewIssueInput,
} from "./newIssue";

describe("checkNewIssueTitle", () => {
  it("前後の空白を外して通す", () => {
    expect(checkNewIssueTitle("  ログイン画面を作る \n")).toEqual({ ok: true, title: "ログイン画面を作る" });
  });
  it("空・空白だけ・文字でない物は断る", () => {
    for (const value of ["", "   ", undefined, 1, null]) {
      expect(checkNewIssueTitle(value)).toEqual({ ok: false, message: NEW_ISSUE_MESSAGES.empty });
    }
  });
  it("途中に改行があれば断る", () => {
    expect(checkNewIssueTitle("a\nb")).toEqual({ ok: false, message: NEW_ISSUE_MESSAGES.multiline });
  });
  it("上限ちょうどは通し、超えたら断る", () => {
    expect(checkNewIssueTitle("あ".repeat(MAX_NEW_ISSUE_TITLE)).ok).toBe(true);
    expect(checkNewIssueTitle("あ".repeat(MAX_NEW_ISSUE_TITLE + 1))).toEqual({
      ok: false,
      message: NEW_ISSUE_MESSAGES.tooLong,
    });
  });
});

const IMAGE_URL =
  "https://github.com/Gaku1205/agent-desk/raw/issue-images/images/202611/0f8e2a1c-3b4d-4e5f-8a9b-0c1d2e3f4a5b.png";

describe("parseNewIssueInput", () => {
  const valid = { owner: "Gaku1205", repo: "agent-desk", title: " メモ ", omakase: false };
  it("正しい値は整えて通す（画像が無ければ空）", () => {
    expect(parseNewIssueInput(valid)).toEqual({ ...valid, title: "メモ", imageUrls: [] });
  });
  it("画像は、そのリポジトリの専用ブランチに上げたURLだけ通す", () => {
    expect(parseNewIssueInput({ ...valid, images: [IMAGE_URL] })?.imageUrls).toEqual([IMAGE_URL]);
  });
  it("不正な画像は全体を null にする", () => {
    for (const images of [
      "x",
      [null],
      [{ data: "AAAA" }],
      [""],
      ["https://evil.example/a.png"],
      [IMAGE_URL.replace("/agent-desk/", "/other/")],
      [IMAGE_URL.replace(".png", ".svg")],
      Array.from({ length: MAX_ISSUE_IMAGES + 1 }, () => IMAGE_URL),
    ]) {
      expect(parseNewIssueInput({ ...valid, images })).toBeNull();
    }
  });
  it("形の違う値は null", () => {
    expect(parseNewIssueInput(null)).toBeNull();
    expect(parseNewIssueInput({ ...valid, owner: "a/b" })).toBeNull();
    expect(parseNewIssueInput({ ...valid, repo: 1 })).toBeNull();
    expect(parseNewIssueInput({ ...valid, omakase: "yes" })).toBeNull();
    expect(parseNewIssueInput({ ...valid, title: "" })).toBeNull();
  });
});

describe("composeNewIssue", () => {
  it("通常のリポジトリはメモがタイトル、本文は空（おまかせは無視）", () => {
    expect(composeNewIssue({ title: "メモ", isTemplate: false, omakase: true })).toEqual({ title: "メモ", body: "" });
  });
  it("テンプレートは「新サービス：」付き、おまかせでなければ本文は空", () => {
    expect(composeNewIssue({ title: "天気のページ", isTemplate: true, omakase: false })).toEqual({
      title: "新サービス：天気のページ",
      body: "",
    });
  });
  it("テンプレートで全部おまかせなら本文にチェックを入れる", () => {
    expect(composeNewIssue({ title: "天気のページ", isTemplate: true, omakase: true })).toEqual({
      title: "新サービス：天気のページ",
      body: OMAKASE_BODY,
    });
    expect(OMAKASE_BODY).toBe("- [x] 全部おまかせ");
  });
  it("画像だけ：通常のリポジトリは本文に ![スクショ](URL) を1枚1行で並べる", () => {
    expect(
      composeNewIssue({
        title: "メモ",
        isTemplate: false,
        omakase: false,
        imageUrls: ["https://x/a.png", "https://x/b.png"],
      }),
    ).toEqual({ title: "メモ", body: "![スクショ](https://x/a.png)\n![スクショ](https://x/b.png)" });
  });
  it("おまかせ＋画像：チェックと画像の間は空行1つ", () => {
    const imageUrls = ["https://x/a.png"];
    expect(composeNewIssue({ title: "天気", isTemplate: true, omakase: true, imageUrls }).body).toBe(
      "- [x] 全部おまかせ\n\n![スクショ](https://x/a.png)",
    );
    expect(composeNewIssue({ title: "天気", isTemplate: true, omakase: false, imageUrls }).body).toBe(
      "![スクショ](https://x/a.png)",
    );
  });
  it("すでに「新サービス：」で始まっていれば重ねない（半角コロンも）", () => {
    expect(composeNewIssue({ title: "新サービス：天気", isTemplate: true, omakase: false }).title).toBe(
      "新サービス：天気",
    );
    expect(composeNewIssue({ title: "新サービス: 天気", isTemplate: true, omakase: false }).title).toBe(
      "新サービス：天気",
    );
  });
});
