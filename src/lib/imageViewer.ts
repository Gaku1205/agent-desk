import type { FactoryChoice, FactoryImage, FactoryStage } from "./factoryTalk";

/** 全体表示で行き来する1つ分（案・方向・画面。画面案は PC とスマホの画像が入る） */
export type ViewerSlide = {
  id: string;
  /** 記号（`A`。無ければ空） */
  mark: string;
  title: string;
  images: FactoryImage[];
};

/**
 * 段階の選択肢から、全体表示の並びを作る（画像が無い案は飛ばす。順は A、B、…のまま）。
 * 見た目の方向は画像1枚、画面は PC・スマホの全部（同じ案の中で行き来できる）
 */
export function viewerSlides(stage: FactoryStage, choices: FactoryChoice[]): ViewerSlide[] {
  return choices
    .map((choice) => ({
      id: choice.value,
      mark: choice.mark,
      title: choice.title,
      images: stage === "looks" ? choice.images.slice(0, 1) : choice.images,
    }))
    .filter((slide) => slide.images.length > 0);
}

/** 次・前の位置（端では止まる） */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** 矢印キーが進める向き（← は −1、→ は +1、ほかは 0） */
export function viewerKeyDelta(key: string): -1 | 0 | 1 {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return 0;
}

/** 別の案へ移ったとき、見ていたのと同じ向き（PC・スマホ）の画像があればそれ、無ければ先頭 */
export function sameDeviceIndex(images: FactoryImage[], device: FactoryImage["device"] | undefined): number {
  const found = images.findIndex((image) => image.device === device);
  return found === -1 ? 0 : found;
}
