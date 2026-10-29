/** 矢印キーでの名札の移動（docs/design.md の「流れ」のキーボード） */

export type NavBox = {
  key: string;
  /** 中心の位置（画面の座標） */
  x: number;
  y: number;
};

export type NavKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function isNavKey(key: string): key is NavKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
}

/** この距離より近い物は「同じ位置」とみなして、その向きの候補にしない（px） */
const EPS = 4;
/** 進む向きとは直角の向きのずれを、何倍に重く見るか（真っ直ぐ並ぶ物を選びやすくする） */
const CROSS = 2.5;

/**
 * いま `from` にいるとき、`key` の向きで動く先のキー。動ける先が無ければ null（そのまま）。
 * `←` `→` `↑` `↓` はその向きにいちばん近い物（ずれが大きい物は避ける）、`Home` は左上、`End` は右下の物
 */
export function nextByArrow(boxes: NavBox[], from: string, key: NavKey): string | null {
  const current = boxes.find((b) => b.key === from);
  if (!current || boxes.length === 0) return null;
  if (key === "Home" || key === "End") {
    const sorted = [...boxes].sort((a, b) => a.x - b.x || a.y - b.y);
    const target = key === "Home" ? sorted[0] : sorted[sorted.length - 1];
    return target.key === from ? null : target.key;
  }
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  let best: { key: string; score: number } | null = null;
  for (const box of boxes) {
    if (box.key === from) continue;
    const along = (horizontal ? box.x - current.x : box.y - current.y) * sign;
    if (along <= EPS) continue;
    const across = Math.abs(horizontal ? box.y - current.y : box.x - current.x);
    const score = along + across * CROSS;
    if (!best || score < best.score) best = { key: box.key, score };
  }
  return best?.key ?? null;
}

/** 停止点にする物：いま選んでいる物が見えていればそれ、無ければ見えている先頭の物（無ければ null） */
export function pickTabStop(keys: string[], visible: ReadonlySet<string>, preferred: string | null): string | null {
  if (preferred !== null && visible.has(preferred)) return preferred;
  return keys.find((key) => visible.has(key)) ?? null;
}
