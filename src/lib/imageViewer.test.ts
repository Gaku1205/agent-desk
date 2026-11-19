import { describe, expect, it } from "vitest";
import type { FactoryChoice, FactoryImage } from "./factoryTalk";
import { sameDeviceIndex, stepIndex, viewerKeyDelta, viewerSlides } from "./imageViewer";

const pc: FactoryImage = { src: "/a-pc.svg", alt: "A PC", device: "pc" };
const mobile: FactoryImage = { src: "/a-m.svg", alt: "A スマホ", device: "mobile" };

function choice(value: string, images: FactoryImage[]): FactoryChoice {
  return { value, mark: value.toUpperCase(), title: `案${value}`, sub: "", text: "", facts: [], colors: [], fonts: "", images };
}

describe("viewerSlides", () => {
  it("画像が無い案は飛ばし、順は変えない", () => {
    const slides = viewerSlides("mocks", [choice("a", [pc, mobile]), choice("b", []), choice("c", [pc])]);
    expect(slides.map((s) => s.id)).toEqual(["a", "c"]);
    expect(slides[0].images).toHaveLength(2);
  });

  it("見た目の方向は画像1枚だけ", () => {
    const slides = viewerSlides("looks", [choice("1", [pc, mobile])]);
    expect(slides[0].images).toEqual([pc]);
  });
});

describe("stepIndex", () => {
  it("端で止まる", () => {
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(1, 1, 3)).toBe(2);
    expect(stepIndex(1, -1, 3)).toBe(0);
  });

  it("空でも 0", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("viewerKeyDelta", () => {
  it("← → だけを進める向きにする", () => {
    expect(viewerKeyDelta("ArrowLeft")).toBe(-1);
    expect(viewerKeyDelta("ArrowRight")).toBe(1);
    expect(viewerKeyDelta("ArrowUp")).toBe(0);
    expect(viewerKeyDelta("?")).toBe(0);
  });
});

describe("sameDeviceIndex", () => {
  it("同じ向きがあればそれ、無ければ先頭", () => {
    expect(sameDeviceIndex([pc, mobile], "mobile")).toBe(1);
    expect(sameDeviceIndex([pc], "mobile")).toBe(0);
    expect(sameDeviceIndex([pc, mobile], undefined)).toBe(0);
  });
});
