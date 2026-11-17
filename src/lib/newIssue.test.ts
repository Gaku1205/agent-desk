import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BASE64_LENGTH, MAX_ISSUE_IMAGES } from "./issueImages";
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

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

describe("parseNewIssueInput", () => {
  const valid = { owner: "Gaku1205", repo: "agent-desk", title: " メモ ", omakase: false };
  it("正しい値は整えて通す（画像が無ければ空）", () => {
    expect(parseNewIssueInput(valid)).toEqual({ ...valid, title: "メモ", images: [] });
  });
  it("画像は確かめ直して中身と種類にする", () => {
    const parsed = parseNewIssueInput({ ...valid, images: [{ data: PNG_BASE64 }] });
    expect(parsed?.images).toHaveLength(1);
    expect(parsed?.images[0].kind).toBe("png");
  });
  it("不正な画像は全体を null にする", () => {
    const notImage = Buffer.from("hello world!").toString("base64");
    for (const images of [
      "x",
      [null],
      [{}],
      [{ data: 1 }],
      [{ data: "" }],
      [{ data: `data:image/png;base64,${PNG_BASE64}` }],
      [{ data: notImage }],
      [{ data: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4) }],
      Array.from({ length: MAX_ISSUE_IMAGES + 1 }, () => ({ data: PNG_BASE64 })),
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
  it("画像だけ：通常のリポジトリは本文に ![](URL) を1枚1行で並べる", () => {
    expect(
      composeNewIssue({
        title: "メモ",
        isTemplate: false,
        omakase: false,
        imageUrls: ["https://x/a.png", "https://x/b.png"],
      }),
    ).toEqual({ title: "メモ", body: "![](https://x/a.png)\n![](https://x/b.png)" });
  });
  it("おまかせ＋画像：チェックと画像の間は空行1つ", () => {
    const imageUrls = ["https://x/a.png"];
    expect(composeNewIssue({ title: "天気", isTemplate: true, omakase: true, imageUrls }).body).toBe(
      "- [x] 全部おまかせ\n\n![](https://x/a.png)",
    );
    expect(composeNewIssue({ title: "天気", isTemplate: true, omakase: false, imageUrls }).body).toBe(
      "![](https://x/a.png)",
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
