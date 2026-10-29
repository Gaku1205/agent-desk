import type { FlowNode, FlowWho } from "./nodes";

/**
 * 流れ（PC）の配置：Issue の光を段階の列の中に置き、名札を常に出す光（人間の番・失敗）だけレーンに並べる。
 * ほかの光は名札を出さず、列の中の格子に置く（名札は乗せたときだけ）。
 * 入力から出力が決まる純粋関数。文字の幅は呼ぶ側が測って渡す（canvas の measureText など）。
 * 寸法の決まりは docs/design.md の「流れ（PC）」
 */

/** 名札の出し方：2行（1行目 番号＋短い説明、2行目 題名）／縦に積む（1行目 番号、2行目 短い説明） */
export type LabelVariant = "full" | "stack";

/** 名札の部品ごとの文字の幅（px） */
export type LabelMetrics = {
  /** `todo-app#23`（1つのリポジトリだけなら `#23`） */
  id: number;
  /** 短い説明（`止まっています`） */
  status: number;
  /** 題名 */
  title: number;
};

export type MeasureLabel = (node: FlowNode) => LabelMetrics;

export type LayoutInput = {
  nodes: FlowNode[];
  /** 流れの幅（px。左右の余白を除く）。左端が 0 */
  width: number;
  /** 光の区域の高さ（px）。上端が 0 */
  height: number;
  /** 名札の文字の大きさ（px） */
  fontSize: number;
  /** 右の余白（名札はここまではみ出してよい） */
  overhang: number;
  measure: MeasureLabel;
};

export type PlacedNode = {
  key: string;
  /** 光の中心（px） */
  x: number;
  y: number;
  /** 段階の列（0〜7） */
  column: number;
  /** 名札を常に出す（人間の番・失敗で、レーンに入った物） */
  pinned: boolean;
  /** 常に出す名札のレーン（出さない光は -1） */
  lane: number;
  /** 名札の幅（px） */
  width: number;
  variant: LabelVariant;
  /** 名札の左上の、光の中心からの位置（px）。乗せたときの名札も同じ */
  dx: number;
  dy: number;
};

export type FlowLayout = {
  placed: PlacedNode[];
  /** 列に入りきらず出さない光 */
  hidden: string[];
  columnWidth: number;
  laneHeight: number;
  lanes: number;
};

/** 光の中心の、列の左端からの位置 */
export const DOT_OFFSET = 20;
/** 光と名札の間 */
export const LABEL_GAP = 16;
/** 名札の左右の余白（文字の幅に足す） */
export const LABEL_PADDING = 12;
/** 名札の幅の上限（文字の大きさの倍数） */
export const MAX_LABEL_EM = 26;
/** 光の中心は、列の右端からこれだけ内側まで */
export const COLUMN_END_MARGIN = 11;
/** 名札の右端と、同じレーンの次の名札の光の間 */
export const LABEL_CLEAR = 12;
/** 名札が右の余白の端に近づいてよい所 */
const EDGE = 2;
/** 乗せたときの名札を光の下（上）に出すときの間 */
export const HOVER_DROP = 12;
/** 光の区域の下の、説明と凡例の行（乗せたときの名札は、ここにかからないように光の上に出す） */
export const FOOT_ROOM = 26;
/** 名札を出さない光の格子の間隔（横・縦）。入らなければ順に詰める */
export const DOT_GRIDS: readonly (readonly [number, number])[] = [
  [22, 20],
  [16, 14],
  [12, 10],
];
/** 格子の点を、名札の範囲・名札のある光から離す */
const SLOT_CLEAR = 8;
const PINNED_CLEAR = 20;

/** 名札（2行）の高さ */
export function labelHeight(fontSize: number): number {
  return fontSize * 2.5 + 4;
}

/** 常に出す名札のレーンの高さ */
export function laneHeightOf(fontSize: number): number {
  return labelHeight(fontSize) + 2;
}

/** 名札を常に出す色：人間の番と失敗だけ */
export function isPinnedWho(who: FlowWho): boolean {
  return who === "human" || who === "fail";
}

/** 名札の部品の間（CSS の gap 0.5em） */
function gapOf(fontSize: number): number {
  return fontSize * 0.5;
}

/** 2行の名札の、ほしい幅と、1行目だけの幅 */
function wants(m: LabelMetrics, fontSize: number) {
  const line1 = m.id + gapOf(fontSize) + m.status;
  return {
    full: Math.ceil(Math.max(line1, m.title)) + LABEL_PADDING,
    line1: Math.ceil(line1) + LABEL_PADDING,
    stack: Math.ceil(Math.max(m.id, m.status)) + LABEL_PADDING,
  };
}

/** 使ってよい幅の中で、名札の出し方と幅を決める：2行（題名は切ってよい）→ 縦に積む → 切る */
export function chooseLabel(
  m: LabelMetrics,
  room: number,
  fontSize: number,
): { variant: LabelVariant; width: number } {
  const want = wants(m, fontSize);
  const cap = Math.min(room, fontSize * MAX_LABEL_EM);
  if (want.line1 <= cap) return { variant: "full", width: Math.max(0, Math.min(want.full, cap)) };
  return { variant: "stack", width: Math.max(0, Math.min(want.stack, cap)) };
}

type Pin = { node: FlowNode; column: number; x: number; lane: number; limit: number; reach: number };
type Rect = { x0: number; x1: number; y0: number; y1: number };

/** 真ん中に近い順（同じなら上）にレーンを並べる */
function byCenter(lanes: number[], total: number): number[] {
  const center = (total - 1) / 2;
  return [...lanes].sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
}

/** 区域の真ん中から上下へ、step 間隔の縦の位置 */
function rowsFromCenter(height: number, step: number): number[] {
  const center = height / 2;
  const out = [center];
  for (let d = 1; ; d++) {
    const below = center + d * step;
    const above = center - d * step;
    const okBelow = below <= height - step / 2 + 0.01;
    const okAbove = above >= step / 2 - 0.01;
    if (!okBelow && !okAbove) break;
    if (okBelow) out.push(below);
    if (okAbove) out.push(above);
  }
  return out;
}

/**
 * 流れの配置を決める。
 * 1. 人間の番・失敗の光を、列ごとに左から、空いているレーンの真ん中寄りに置き、名札の幅を決める（右へ伸ばし、反転しない）
 * 2. ほかの光（と、レーンに入らなかった物）を、列の中の格子の空いた所に置く。入らなければ格子を詰める
 */
export function layoutFlow(input: LayoutInput): FlowLayout {
  // 名札のレーンで列がふさがり、名札を出さない光が入らない列は、その列の常に出す名札を1つずつ減らして置き直す
  const lanes = Math.max(1, Math.floor(input.height / laneHeightOf(input.fontSize)));
  const maxPinned = Array.from({ length: 8 }, () => lanes);
  let layout = place(input, maxPinned);
  for (let guard = 0; guard < 8 * lanes && layout.hidden.length > 0; guard++) {
    const columns = new Set<number>();
    for (const key of layout.hidden) {
      const node = input.nodes.find((n) => n.key === key);
      if (node) columns.add(Math.min(7, Math.max(0, node.at)));
    }
    const shrink = [...columns].filter((c) => maxPinned[c] > 0);
    if (shrink.length === 0) break;
    for (const c of shrink) maxPinned[c] -= 1;
    layout = place(input, maxPinned);
  }
  return layout;
}

function place(input: LayoutInput, maxPinned: number[]): FlowLayout {
  const { nodes, width, height, fontSize, overhang, measure } = input;
  const columnWidth = width / 8;
  const lh = labelHeight(fontSize);
  const laneH = laneHeightOf(fontSize);
  const lanes = Math.max(1, Math.floor(height / laneH));
  const laneTop = Math.max(0, (height - lanes * laneH) / 2);
  const laneY = (lane: number) => laneTop + (lane + 0.5) * laneH;
  const rightEdge = width + overhang - EDGE;
  const colOf = (node: FlowNode) => Math.min(7, Math.max(0, node.at));
  const dotX = (column: number) => column * columnWidth + DOT_OFFSET;

  // 1. 常に名札を出す光
  const reach: (Pin | null)[] = Array.from({ length: lanes }, () => null);
  const pins: Pin[] = [];
  const pinnedKeys = new Set<string>();
  for (let column = 0; column < 8; column++) {
    const candidates = nodes.filter((n) => colOf(n) === column && isPinnedWho(n.who)).slice(0, Math.min(lanes, maxPinned[column]));
    const x = dotX(column);
    const used = new Set<number>();
    for (const node of candidates) {
      const open = Array.from({ length: lanes }, (_, l) => l).filter((l) => !used.has(l));
      const free = open.filter((l) => {
        const prev = reach[l];
        return prev === null || prev.reach + LABEL_CLEAR <= x;
      });
      const lane = byCenter(free.length > 0 ? free : open, lanes)[0];
      const prev = reach[lane];
      if (prev && prev.reach + LABEL_CLEAR > x) {
        // 左の列の名札を、この光の手前で切る
        prev.limit = Math.min(prev.limit, x - LABEL_CLEAR - (prev.x + LABEL_GAP));
      }
      const want = wants(measure(node), fontSize);
      const pin: Pin = {
        node,
        column,
        x,
        lane,
        limit: Infinity,
        reach: x + LABEL_GAP + Math.min(want.full, fontSize * MAX_LABEL_EM),
      };
      used.add(lane);
      reach[lane] = pin;
      pins.push(pin);
      pinnedKeys.add(node.key);
    }
  }

  const placed: PlacedNode[] = [];
  const rects: Rect[] = [];
  const pinPoints: { x: number; y: number }[] = [];
  for (const pin of pins) {
    const room = Math.min(pin.limit, rightEdge - (pin.x + LABEL_GAP));
    const { variant, width: w } = chooseLabel(measure(pin.node), room, fontSize);
    const y = laneY(pin.lane);
    placed.push({
      key: pin.node.key,
      x: pin.x,
      y,
      column: pin.column,
      pinned: true,
      lane: pin.lane,
      width: w,
      variant,
      dx: LABEL_GAP,
      dy: -lh / 2,
    });
    rects.push({ x0: pin.x - 10, x1: pin.x + LABEL_GAP + w, y0: y - lh / 2, y1: y + lh / 2 });
    pinPoints.push({ x: pin.x, y });
  }

  // 2. 名札を出さない光
  const hidden: string[] = [];
  const blocked = (x: number, y: number) =>
    rects.some((r) => x >= r.x0 - SLOT_CLEAR && x <= r.x1 + SLOT_CLEAR && y >= r.y0 - SLOT_CLEAR && y <= r.y1 + SLOT_CLEAR) ||
    pinPoints.some((p) => Math.abs(p.x - x) < PINNED_CLEAR && Math.abs(p.y - y) < PINNED_CLEAR);
  for (let column = 0; column < 8; column++) {
    const dots = nodes.filter((n) => colOf(n) === column && !pinnedKeys.has(n.key));
    if (dots.length === 0) continue;
    const colRight = (column + 1) * columnWidth - COLUMN_END_MARGIN;
    let slots: { x: number; y: number }[] = [];
    for (const [stepX, stepY] of DOT_GRIDS) {
      slots = [];
      for (let j = 0; ; j++) {
        const x = dotX(column) + j * stepX;
        if (j > 0 && x > colRight + 0.01) break;
        for (const y of rowsFromCenter(height, stepY)) if (!blocked(x, y)) slots.push({ x, y });
      }
      if (slots.length >= dots.length) break;
    }
    dots.forEach((node, index) => {
      const slot = slots[index];
      if (!slot) {
        hidden.push(node.key);
        return;
      }
      const m = measure(node);
      const { variant, width: w } = chooseLabel(m, rightEdge, fontSize);
      let dx = LABEL_GAP;
      let dy = -lh / 2;
      if (slot.x + LABEL_GAP + w > rightEdge) {
        // 右端に入らない：左へずらして右端をそろえ、光の下（入らなければ上）に出す。反転はしない
        dx = Math.max(-slot.x, rightEdge - w - slot.x);
        dy = slot.y + HOVER_DROP + lh <= height ? HOVER_DROP : -HOVER_DROP - lh;
      }
      placed.push({ key: node.key, x: slot.x, y: slot.y, column, pinned: false, lane: -1, width: w, variant, dx, dy });
    });
  }

  return { placed, hidden, columnWidth, laneHeight: laneH, lanes };
}

/** スマホの細い帯：段階ごとに1つの光にまとめる */
export type StripColumn = {
  at: number;
  keys: string[];
  count: number;
  /** 中の Issue の色（粒の色に使う） */
  whos: FlowWho[];
  /** いちばん目立つ色（人間 → 失敗 → AI → 待機 → 公開済み） */
  lead: FlowWho | null;
};

const LEAD_ORDER: FlowWho[] = ["human", "fail", "ai", "queue", "done"];

export function stripColumns(nodes: FlowNode[]): StripColumn[] {
  return Array.from({ length: 8 }, (_, at) => {
    const members = nodes.filter((n) => n.at === at);
    const whos = members.map((n) => n.who);
    const lead = LEAD_ORDER.find((who) => whos.includes(who)) ?? null;
    return { at, keys: members.map((n) => n.key), count: members.length, whos, lead };
  });
}
