import { describe, expect, it } from "vitest";
import { MAX_ISSUE_IMAGES } from "./issueImages";
import {
  appendExample,
  checkNewIssueMemo,
  composeNewIssue,
  createdServiceHref,
  MAX_NEW_ISSUE_MEMO,
  MAX_NEW_ISSUE_TITLE,
  memoLength,
  memoTitle,
  NEW_ISSUE_MESSAGES,
  OMAKASE_BODY,
  omakaseHint,
  parseNewIssueInput,
  SERVICE_EXAMPLES,
} from "./newIssue";

describe("omakaseHint", () => {
  it("オフ・オンの補足の1行", () => {
    expect(omakaseHint(false)).toBe("案・見た目・最終確認の3回、Your turn で選ぶ");
    expect(omakaseHint(true)).toBe("相談なしで公開まで（30分ほど）");
  });
});

describe("書き方の見本", () => {
  it("見本は2〜3個", () => {
    expect(SERVICE_EXAMPLES.length).toBeGreaterThanOrEqual(2);
    expect(SERVICE_EXAMPLES.length).toBeLessThanOrEqual(3);
  });
  it("空・空白だけなら見本だけを入れる", () => {
    expect(appendExample("", "見本")).toBe("見本");
    expect(appendExample("  \n", "見本")).toBe("見本");
  });
  it("書いてあれば消さずに、改行をはさんで後ろに足す", () => {
    expect(appendExample("天気のページ", "見本")).toBe("天気のページ\n見本");
    expect(appendExample("天気のページ\n\n", "見本")).toBe("天気のページ\n見本");
  });
});

describe("createdServiceHref", () => {
  it("agent-desk の中のリポジトリのページ", () => {
    expect(createdServiceHref("Gaku1205/ai-dev-template")).toBe("/repos/Gaku1205/ai-dev-template");
    expect(createdServiceHref("demo/landing-page", "/demo")).toBe("/demo/repos/demo/landing-page");
  });
});

describe("checkNewIssueMemo", () => {
  it("前後の空白を外して通す", () => {
    expect(checkNewIssueMemo("  ログイン画面を作る \n")).toEqual({ ok: true, memo: "ログイン画面を作る" });
  });
  it("空・空白だけ・文字でない物は断る", () => {
    for (const value of ["", "   ", "\n\n", undefined, 1, null]) {
      expect(checkNewIssueMemo(value)).toEqual({ ok: false, message: NEW_ISSUE_MESSAGES.empty });
    }
  });
  it("複数行は通す（改行はそのまま残る）", () => {
    expect(checkNewIssueMemo("題\n\n本文の1行目\n本文の2行目")).toEqual({
      ok: true,
      memo: "題\n\n本文の1行目\n本文の2行目",
    });
  });
  it("4000文字ちょうどは通し、4001文字は断る", () => {
    expect(checkNewIssueMemo("あ".repeat(MAX_NEW_ISSUE_MEMO)).ok).toBe(true);
    expect(checkNewIssueMemo("あ".repeat(MAX_NEW_ISSUE_MEMO + 1))).toEqual({
      ok: false,
      message: NEW_ISSUE_MESSAGES.tooLong,
    });
    expect(NEW_ISSUE_MESSAGES.tooLong).toBe("メモは4,000文字以内にしてください");
  });
  it("文字数はコードポイントで数える（絵文字は1文字）", () => {
    expect(memoLength("😀a")).toBe(2);
    expect(checkNewIssueMemo("😀".repeat(MAX_NEW_ISSUE_MEMO)).ok).toBe(true);
    expect(checkNewIssueMemo("😀".repeat(MAX_NEW_ISSUE_MEMO + 1)).ok).toBe(false);
  });
});

describe("memoTitle", () => {
  it("1行目が題（前後の空白を外す）", () => {
    expect(memoTitle("  題 \n本文")).toBe("題");
  });
  it("最初の行が空なら、最初の空でない行", () => {
    expect(memoTitle("\n  \n題\n本文")).toBe("題");
  });
  it("1行目が120文字ちょうどならそのまま、121文字なら先頭120文字＋…", () => {
    const exact = "あ".repeat(MAX_NEW_ISSUE_TITLE);
    expect(memoTitle(exact)).toBe(exact);
    expect(memoTitle(`${exact}あ\n本文`)).toBe(`${exact}…`);
  });
});

const IMAGE_URL =
  "https://github.com/Gaku1205/agent-desk/raw/issue-images/images/202611/0f8e2a1c-3b4d-4e5f-8a9b-0c1d2e3f4a5b.png";

describe("parseNewIssueInput", () => {
  const valid = { owner: "Gaku1205", repo: "agent-desk", memo: " メモ ", omakase: false };
  it("正しい値は整えて通す（画像が無ければ空）", () => {
    expect(parseNewIssueInput(valid)).toEqual({ ...valid, memo: "メモ", imageUrls: [] });
  });
  it("複数行・4000文字ちょうどは通し、4001文字は null", () => {
    expect(parseNewIssueInput({ ...valid, memo: "題\n本文" })?.memo).toBe("題\n本文");
    expect(parseNewIssueInput({ ...valid, memo: "あ".repeat(MAX_NEW_ISSUE_MEMO) })).not.toBeNull();
    expect(parseNewIssueInput({ ...valid, memo: "あ".repeat(MAX_NEW_ISSUE_MEMO + 1) })).toBeNull();
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
    expect(parseNewIssueInput({ ...valid, memo: "" })).toBeNull();
    expect(parseNewIssueInput({ ...valid, memo: " \n " })).toBeNull();
  });
});

describe("composeNewIssue", () => {
  it("通常のリポジトリ：1行のメモは題になり、全文が本文にも入る（おまかせは無視）", () => {
    expect(composeNewIssue({ memo: "メモ", isTemplate: false, omakase: true })).toEqual({ title: "メモ", body: "メモ" });
  });
  it("複数行：1行目が題、全文が本文", () => {
    expect(composeNewIssue({ memo: "題\n\n詳しい話\n続き", isTemplate: false, omakase: false })).toEqual({
      title: "題",
      body: "題\n\n詳しい話\n続き",
    });
  });
  it("1行目が120文字ちょうどならそのまま、121文字なら先頭120文字＋…（全文は本文に入る）", () => {
    const exact = "あ".repeat(120);
    expect(composeNewIssue({ memo: exact, isTemplate: false, omakase: false }).title).toBe(exact);
    const long = composeNewIssue({ memo: `${exact}い\n本文`, isTemplate: false, omakase: false });
    expect(long.title).toBe(`${exact}…`);
    expect(long.body).toBe(`${exact}い\n本文`);
  });
  it("最初の行が空なら、最初の空でない行が題", () => {
    expect(composeNewIssue({ memo: "\n\n題\n本文", isTemplate: false, omakase: false }).title).toBe("題");
  });
  it("テンプレートは「新サービス：」を題の頭に付けるだけ。本文はメモの全文", () => {
    expect(composeNewIssue({ memo: "天気のページ\nくわしく", isTemplate: true, omakase: false })).toEqual({
      title: "新サービス：天気のページ",
      body: "天気のページ\nくわしく",
    });
  });
  it("テンプレートで全部おまかせなら、メモの下に空行1つでチェックを入れる", () => {
    expect(composeNewIssue({ memo: "天気のページ", isTemplate: true, omakase: true })).toEqual({
      title: "新サービス：天気のページ",
      body: `天気のページ\n\n${OMAKASE_BODY}`,
    });
    expect(OMAKASE_BODY).toBe("- [x] 全部おまかせ");
  });
  it("画像：メモの下に空行1つで、![スクショ](URL) を1枚1行で並べる", () => {
    expect(
      composeNewIssue({
        memo: "メモ",
        isTemplate: false,
        omakase: false,
        imageUrls: ["https://x/a.png", "https://x/b.png"],
      }),
    ).toEqual({ title: "メモ", body: "メモ\n\n![スクショ](https://x/a.png)\n![スクショ](https://x/b.png)" });
  });
  it("おまかせ＋画像：メモ・チェック・画像は空行1つで分ける", () => {
    const imageUrls = ["https://x/a.png"];
    expect(composeNewIssue({ memo: "天気", isTemplate: true, omakase: true, imageUrls }).body).toBe(
      "天気\n\n- [x] 全部おまかせ\n\n![スクショ](https://x/a.png)",
    );
    expect(composeNewIssue({ memo: "天気", isTemplate: true, omakase: false, imageUrls }).body).toBe(
      "天気\n\n![スクショ](https://x/a.png)",
    );
  });
  it("すでに「新サービス：」で始まっていれば重ねない（半角コロンも）", () => {
    expect(composeNewIssue({ memo: "新サービス：天気", isTemplate: true, omakase: false }).title).toBe(
      "新サービス：天気",
    );
    expect(composeNewIssue({ memo: "新サービス: 天気", isTemplate: true, omakase: false }).title).toBe(
      "新サービス：天気",
    );
  });
});
