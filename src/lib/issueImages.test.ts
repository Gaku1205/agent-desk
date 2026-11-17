import { describe, expect, it } from "vitest";
import {
  detectImageKind,
  IMAGE_MESSAGES,
  imagePath,
  imageUrl,
  isFileDrag,
  MAX_ISSUE_IMAGE_BYTES,
  MAX_ISSUE_IMAGES,
  parseImageBytes,
  parseImageUrls,
  pickAddableImages,
} from "./issueImages";

describe("isFileDrag", () => {
  it("Files を含むとき（画像などのファイル）は true", () => {
    expect(isFileDrag(["Files"])).toBe(true);
    expect(isFileDrag(["text/plain", "Files"])).toBe(true);
  });
  it("文字・リンクだけのドラッグは false（空も false）", () => {
    expect(isFileDrag(["text/plain"])).toBe(false);
    expect(isFileDrag(["text/plain", "text/html", "text/uri-list"])).toBe(false);
    expect(isFileDrag([])).toBe(false);
  });
});

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const head = (bytes: number[]) => new Uint8Array(bytes);

describe("detectImageKind", () => {
  it("先頭のバイトで4種類を見分ける", () => {
    expect(detectImageKind(head(PNG))).toBe("png");
    expect(detectImageKind(head(JPEG))).toBe("jpeg");
    expect(detectImageKind(head(GIF))).toBe("gif");
    expect(detectImageKind(head(WEBP))).toBe("webp");
  });
  it("それ以外（SVG・RIFF の WAV・空）は null", () => {
    expect(detectImageKind(new TextEncoder().encode("<svg xmlns"))).toBeNull();
    expect(detectImageKind(head([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(detectImageKind(new Uint8Array())).toBeNull();
  });
});

describe("pickAddableImages", () => {
  const png = { size: 100, head: head(PNG) };
  it("決まりの内側は全部足す", () => {
    expect(pickAddableImages(0, [png, png])).toEqual({ accepted: [0, 1], message: null });
  });
  it("種類が違うものは足さず、文を返す", () => {
    const text = { size: 10, head: new TextEncoder().encode("hello world!") };
    expect(pickAddableImages(0, [text, png])).toEqual({ accepted: [1], message: IMAGE_MESSAGES.badType });
  });
  it("1枚4MBちょうどは足し、超えたら足さない", () => {
    expect(pickAddableImages(0, [{ ...png, size: MAX_ISSUE_IMAGE_BYTES }]).accepted).toEqual([0]);
    expect(pickAddableImages(0, [{ ...png, size: MAX_ISSUE_IMAGE_BYTES + 1 }])).toEqual({
      accepted: [],
      message: IMAGE_MESSAGES.tooLarge,
    });
  });
  it("5枚までで、超えた分は足さない", () => {
    expect(pickAddableImages(4, [png, png])).toEqual({ accepted: [0], message: IMAGE_MESSAGES.tooMany });
    expect(pickAddableImages(MAX_ISSUE_IMAGES, [png]).message).toBe(IMAGE_MESSAGES.tooMany);
  });
  it("固定文", () => {
    expect(IMAGE_MESSAGES).toEqual({
      tooMany: "画像は5枚までです",
      tooLarge: "画像は1枚4MBまでです",
      badType: "画像は PNG・JPEG・WebP・GIF だけです",
    });
  });
});

describe("parseImageBytes", () => {
  it("4種類の中身は種類を付けて通す", () => {
    expect(parseImageBytes(head(PNG))?.kind).toBe("png");
    expect(parseImageBytes(head(WEBP))?.kind).toBe("webp");
  });
  it("空・種類の違うもの・4MBを超えるものは断る", () => {
    expect(parseImageBytes(new Uint8Array())).toBeNull();
    expect(parseImageBytes(new TextEncoder().encode("hello world!"))).toBeNull();
    const exact = new Uint8Array(MAX_ISSUE_IMAGE_BYTES);
    exact.set(PNG);
    expect(parseImageBytes(exact)?.kind).toBe("png");
    const big = new Uint8Array(MAX_ISSUE_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(parseImageBytes(big)).toBeNull();
  });
});

describe("parseImageUrls", () => {
  const url = "https://github.com/o/r/raw/issue-images/images/202611/0f8e2a1c-3b4d-4e5f-8a9b-0c1d2e3f4a5b.png";
  it("未指定は空、専用ブランチに上げた形は通す", () => {
    expect(parseImageUrls("o", "r", undefined)).toEqual([]);
    expect(parseImageUrls("o", "r", [url, url.replace(".png", ".jpg")])).toEqual([url, url.replace(".png", ".jpg")]);
  });
  it("5枚を超える・形の違うURLは null", () => {
    expect(parseImageUrls("o", "r", Array.from({ length: MAX_ISSUE_IMAGES + 1 }, () => url))).toBeNull();
    for (const bad of [
      {},
      [1],
      [url.replace("/o/r/", "/o/other/")],
      [url.replace("issue-images", "main")],
      [url.replace(".png", ".svg")],
      [url.replace("0f8e2a1c", "../../x")],
      [`${url})\n![x](https://evil.example/a.png`],
      ["https://evil.example/a.png"],
    ]) {
      expect(parseImageUrls("o", "r", bad)).toBeNull();
    }
  });
});

describe("置き場所", () => {
  it("パスは年月＋ランダムな名前＋拡張子", () => {
    expect(imagePath("jpeg", new Date("2026-11-17T00:00:00Z"), "abc")).toBe("images/202611/abc.jpg");
  });
  it("本文のURLは専用ブランチの raw", () => {
    expect(imageUrl("o", "r", "images/202611/abc.png")).toBe(
      "https://github.com/o/r/raw/issue-images/images/202611/abc.png",
    );
  });
});
