import type { FlowNode, FlowWho } from "./nodes";

/**
 * 流れ（PC）の配置：光の区域を横のレーン（光の筋）に分け、Issue の光をレーンの上、自分の段階の列の中に置く。
 * 名札を常に出すのは人間の番と失敗だけ。公開済みは右端の1つの塊にまとめる。
 * レーンと、レーンの上の位置（席）は、その Issue が同じ列にいる間は固定する。前の席（prev）を渡すと、
 * 列が変わった物と新しい物だけを空いた席に置き、ほかの光と名札は動かさない。
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

/** 光の席：段階の列・レーン・レーンの上の位置（列の左から何番目か） */
export type Seat = { column: number; lane: number; slot: number };

/** 前の配置（席を保つために次の配置へ渡す） */
export type PrevSeats = {
  seats: ReadonlyMap<string, Seat>;
  lanes: number;
  gap: number;
  /** 公開済みの塊のレーン */
  clusterLane: number | null;
};

export type LayoutInput = {
  nodes: FlowNode[];
  /** 流れの幅（px。左右の余白を除く）。左端が 0 */
  width: number;
  /** 光の区域の高さ（px）。上端が 0 */
  height: number;
  /** 名札の文字の大きさ（px） */
  fontSize: number;
  /** 右の余白（名札と公開済みの塊はここまで使ってよい） */
  overhang: number;
  measure: MeasureLabel;
  /** 前の配置。あれば席を保つ */
  prev?: PrevSeats | null;
  /** 公開済みの塊の名札の文字の幅 */
  clusterMetrics?: LabelMetrics;
};

/** 名札の位置（光の中心からの左上） */
export type LabelBox = { width: number; variant: LabelVariant; dx: number; dy: number };

export type PlacedNode = LabelBox & {
  key: string;
  /** 光の中心（px） */
  x: number;
  y: number;
  /** 段階の列（0〜7） */
  column: number;
  /** 名札を常に出す（人間の番・失敗） */
  pinned: boolean;
  lane: number;
  slot: number;
};

/** 右端の、公開済みの塊（1つの光と、乗せたときの名札） */
export type DoneCluster = LabelBox & { keys: string[]; x: number; y: number; lane: number };

export type FlowLayout = {
  placed: PlacedNode[];
  /** 列に入りきらず出さない光 */
  hidden: string[];
  cluster: DoneCluster | null;
  columnWidth: number;
  laneHeight: number;
  lanes: number;
  /** レーン（光の筋）の縦の位置 */
  laneYs: number[];
  /** 次の配置に渡す席 */
  next: PrevSeats;
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
/** 名札の右端と、同じレーンの次の光の間 */
export const LABEL_CLEAR = 12;
/** 名札が右の余白の端に近づいてよい所 */
const EDGE = 2;
/** 乗せたときの名札を光の下（上）に出すときの間 */
export const HOVER_DROP = 12;
/** 光の区域の下の、説明と凡例の行（乗せたときの名札は、ここにかからない） */
export const FOOT_ROOM = 26;
/** 光の区域の上の、段階の目盛り（乗せたときの名札は、ここまでかかってよい） */
export const STAGES_ROOM = 30;
/** レーンの数の上限（大きな画面で筋が五線譜のように並ばないように） */
export const MAX_LANES = 6;
/** 同じレーン・同じ列の光の間隔。入らなければ順に詰める */
export const SLOT_GAPS: readonly number[] = [22, 16, 12];
/** 名札の範囲と光の間 */
const SLOT_CLEAR = 8;
/** 名札を常に出す光の左（名札の範囲は光の左10pxから） */
const LABEL_LEFT = 10;
/** 光と光の最小の間（同じレーン） */
const MIN_SEP = 10;

/** 名札（2行）の高さ */
export function labelHeight(fontSize: number): number {
  return fontSize * 2.5 + 4;
}

/** レーンの高さ（名札の高さ＋2px） */
export function laneHeightOf(fontSize: number): number {
  return labelHeight(fontSize) + 2;
}

/** 区域の高さで決まるレーンの数（1〜MAX_LANES） */
export function laneCountOf(height: number, fontSize: number): number {
  return Math.max(1, Math.min(MAX_LANES, Math.floor(height / laneHeightOf(fontSize))));
}

/** レーンの縦の位置：レーンを区域の高さに均等に配る（レーンの高さより狭くはしない） */
export function laneYsOf(height: number, fontSize: number): number[] {
  const lanes = laneCountOf(height, fontSize);
  const step = Math.max(laneHeightOf(fontSize), Math.min(height / lanes, laneHeightOf(fontSize) * 1.5));
  const top = (height - step * lanes) / 2;
  return Array.from({ length: lanes }, (_, l) => top + (l + 0.5) * step);
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

export type Rect = { x0: number; x1: number; y0: number; y1: number };

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 乗せたときの名札の位置と幅：光の右（同じ高さ）→ 光の下 → 光の上 → 光の左 → 左へ寄せた下・上 の順に、
 * 常に出ている名札と重ならない物を選ぶ。2行で重なるなら、縦に積む出し方（幅が狭い）でも探す。
 * 文字はいつも左揃えで、光そのものは隠さない。右端に入らないときは、左へずらして右端をそろえる。
 * どれも重なるときは、重なりのいちばん小さい物
 */
export function hoverLabelBox(
  x: number,
  y: number,
  m: LabelMetrics,
  input: { fontSize: number; height: number; rightEdge: number; avoid: readonly Rect[] },
): LabelBox {
  const lh = labelHeight(input.fontSize);
  const want = wants(m, input.fontSize);
  const cap = input.fontSize * MAX_LABEL_EM;
  const shapes: { variant: LabelVariant; width: number }[] = [
    { variant: "full", width: Math.min(want.full, cap) },
    { variant: "stack", width: Math.min(want.stack, cap) },
  ];
  let best: LabelBox | null = null;
  let bestArea = Infinity;
  for (const { variant, width } of shapes) {
    const fits = x + LABEL_GAP + width <= input.rightEdge;
    const right = fits ? LABEL_GAP : Math.max(-x, input.rightEdge - width - x);
    const leftward = Math.max(-x, -width + LABEL_GAP);
    const down = HOVER_DROP;
    const up = -HOVER_DROP - lh;
    const candidates: { dx: number; dy: number }[] = [
      ...(fits ? [{ dx: LABEL_GAP, dy: -lh / 2 }] : []),
      { dx: right, dy: down },
      { dx: right, dy: up },
      ...(x - LABEL_GAP - width >= 0 ? [{ dx: -LABEL_GAP - width, dy: -lh / 2 }] : []),
      { dx: leftward, dy: down },
      { dx: leftward, dy: up },
    ].filter(
      (c) =>
        y + c.dy >= -STAGES_ROOM - 0.01 && y + c.dy + lh <= input.height + 0.01 && x + c.dx + width <= input.rightEdge + 0.01,
    );
    for (const c of candidates) {
      const r = { x0: x + c.dx, x1: x + c.dx + width, y0: y + c.dy, y1: y + c.dy + lh };
      const area = input.avoid.reduce((sum, a) => sum + overlapArea(r, a), 0);
      if (area < bestArea - 0.01) {
        best = { ...c, width, variant };
        bestArea = area;
      }
      if (bestArea === 0) return best ?? { ...c, width, variant };
    }
  }
  if (best) return best;
  const width = shapes[0].width;
  return { dx: Math.max(-x, Math.min(LABEL_GAP, input.rightEdge - width - x)), dy: -HOVER_DROP - lh, width, variant: "full" };
}

/** 真ん中に近い順（同じなら上）にレーンを並べる */
function byCenter(total: number): number[] {
  const center = (total - 1) / 2;
  return Array.from({ length: total }, (_, l) => l).sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
}

type Light = { key: string; x: number; pinned: boolean; reach: number };

/**
 * 流れの配置を決める。
 * 前の配置（prev）があり、レーンの数が同じなら、同じ列にいる光の席は変えない。列が変わった物・新しい物だけを
 * 空いた席に置く（同じレーンを優先）。置けない物があるときだけ、全部を置き直す。
 */
export function layoutFlow(input: LayoutInput): FlowLayout {
  const lanes = laneCountOf(input.height, input.fontSize);
  if (input.prev && input.prev.lanes === lanes && input.prev.seats.size > 0) {
    const kept = place(input, input.prev.gap, Array.from({ length: 8 }, () => lanes), input.prev);
    if (kept && kept.hidden.length === 0) return kept;
  }
  return fresh(input);
}

/** 全部を置き直す：光の間隔を詰めながら、全部が入る配置を探す */
function fresh(input: LayoutInput): FlowLayout {
  const lanes = laneCountOf(input.height, input.fontSize);
  let last: FlowLayout | null = null;
  for (const gap of SLOT_GAPS) {
    // 名札のレーンで列がふさがり、名札を出さない光が入らない列は、その列の常に出す名札を1つずつ減らして置き直す
    const maxPinned = Array.from({ length: 8 }, () => lanes);
    let layout = place(input, gap, maxPinned, null);
    for (let guard = 0; layout && guard < 8 * lanes && layout.hidden.length > 0; guard++) {
      const columns = new Set<number>();
      for (const key of layout.hidden) {
        const node = input.nodes.find((n) => n.key === key);
        if (node) columns.add(colOf(node));
      }
      const shrink = [...columns].filter((c) => maxPinned[c] > 0);
      if (shrink.length === 0) break;
      for (const c of shrink) maxPinned[c] -= 1;
      layout = place(input, gap, maxPinned, null);
    }
    if (layout) last = layout;
    if (layout && layout.hidden.length === 0) return layout;
  }
  return last ?? emptyLayout(input);
}

function colOf(node: FlowNode): number {
  return Math.min(7, Math.max(0, node.at));
}

function emptyLayout(input: LayoutInput): FlowLayout {
  const lanes = laneCountOf(input.height, input.fontSize);
  return {
    placed: [],
    hidden: input.nodes.map((n) => n.key),
    cluster: null,
    columnWidth: input.width / 8,
    laneHeight: laneHeightOf(input.fontSize),
    lanes,
    laneYs: laneYsOf(input.height, input.fontSize),
    next: { seats: new Map(), lanes, gap: SLOT_GAPS[0], clusterLane: null },
  };
}

/** 1つの配置。prev があるのに置けない光があれば null（呼ぶ側が置き直す） */
function place(input: LayoutInput, gap: number, maxPinned: number[], prev: PrevSeats | null): FlowLayout | null {
  const { nodes, width, height, fontSize, overhang, measure } = input;
  const columnWidth = width / 8;
  const lh = labelHeight(fontSize);
  const laneYs = laneYsOf(height, fontSize);
  const lanes = laneYs.length;
  const rightEdge = width + overhang - EDGE;
  const capacity = Math.max(1, Math.floor((columnWidth - DOT_OFFSET - COLUMN_END_MARGIN) / gap) + 1);
  const xOf = (column: number, slot: number) => column * columnWidth + DOT_OFFSET + slot * gap;
  const order = byCenter(lanes);
  const centerRank = (lane: number) => order.indexOf(lane);

  const done = nodes.filter((n) => n.who === "done");
  const rest = nodes.filter((n) => n.who !== "done");

  // レーンごとの光（x の順）
  const lightsIn: Light[][] = Array.from({ length: lanes }, () => []);
  const seats = new Map<string, Seat>();
  const pinnedKeys = new Set<string>();
  const add = (lane: number, light: Light) => {
    lightsIn[lane].push(light);
    lightsIn[lane].sort((a, b) => a.x - b.x);
  };
  /** そのレーンの x の右にある、いちばん近い光 */
  const nextRight = (lane: number, x: number, except: string) =>
    lightsIn[lane].find((l) => l.x > x + 0.01 && l.key !== except)?.x ?? Infinity;
  /** 常に出す名札が使ってよい幅（同じレーンの右の光の手前まで） */
  const roomAt = (lane: number, x: number, key: string) =>
    Math.min(nextRight(lane, x, key) - LABEL_CLEAR, rightEdge) - (x + LABEL_GAP);
  const blocked = (lane: number, x: number) =>
    lightsIn[lane].some(
      (l) => Math.abs(l.x - x) < MIN_SEP || (l.pinned && x >= l.x - LABEL_LEFT - SLOT_CLEAR && x <= l.reach + SLOT_CLEAR),
    );
  const wantsPin = (node: FlowNode) => isPinnedWho(node.who);

  // 1. 席を保つ光（同じ列にいて、席がまだ使える物）
  const pending: FlowNode[] = [];
  if (prev) {
    for (const node of rest) {
      const seat = prev.seats.get(node.key);
      if (seat && seat.column === colOf(node) && seat.lane < lanes && seat.slot < capacity) {
        const pinned = wantsPin(node);
        add(seat.lane, { key: node.key, x: xOf(seat.column, seat.slot), pinned, reach: -Infinity });
        seats.set(node.key, seat);
        if (pinned) pinnedKeys.add(node.key);
      } else {
        pending.push(node);
      }
    }
    // 保った名札の範囲（右の光の手前まで）
    for (const node of rest) {
      const seat = seats.get(node.key);
      if (!seat || !pinnedKeys.has(node.key)) continue;
      const light = lightsIn[seat.lane].find((l) => l.key === node.key);
      if (!light) continue;
      const room = roomAt(seat.lane, light.x, node.key);
      light.reach = light.x + LABEL_GAP + chooseLabel(measure(node), room, fontSize).width;
    }
  } else {
    pending.push(...rest);
  }

  // 2. 新しく置く光：名札を出す物（列の左から）→ ほか
  const hidden: string[] = [];
  const pinnedCount = Array.from({ length: 8 }, (_, c) => [...pinnedKeys].filter((k) => seats.get(k)?.column === c).length);
  const pendPinned = pending.filter(wantsPin).sort((a, b) => colOf(a) - colOf(b));
  const pendDots = pending.filter((n) => !wantsPin(n));
  for (const node of pendPinned) {
    const column = colOf(node);
    const prevLane = prev?.seats.get(node.key)?.lane ?? -1;
    if (pinnedCount[column] >= maxPinned[column]) {
      pendDots.push(node);
      continue;
    }
    const want = wants(measure(node), fontSize);
    // 席の候補：レーンごとに、左からいちばん近い空いた席。名札の入る幅が広いほど、左の席ほど、前と同じレーンほど、真ん中ほど良い
    let best: { lane: number; slot: number; score: number; cut: boolean } | null = null;
    for (let lane = 0; lane < lanes; lane++) {
      const x0 = xOf(column, 0);
      const inColumn = lightsIn[lane].some((l) => l.x >= column * columnWidth - 0.01 && l.x < (column + 1) * columnWidth);
      if (!prev && !inColumn && blocked(lane, x0) && !lightsIn[lane].some((l) => Math.abs(l.x - x0) < MIN_SEP)) {
        // 置き直すとき：左の列の名札がかかっているだけなら、その名札をこの光の手前で切って置ける（名札の入る席が無いとき）
        const score = 50000 + centerRank(lane);
        if (!best || score < best.score) best = { lane, slot: 0, score, cut: true };
      }
      for (let slot = 0; slot < capacity; slot++) {
        const sx = xOf(column, slot);
        if (blocked(lane, sx)) continue;
        const room = roomAt(lane, sx, node.key);
        const fit = room >= want.full ? 0 : room >= want.line1 ? 1 : room >= want.stack ? 2 : 6;
        const score = fit * 10000 + slot * 100 + (prev && lane !== prevLane ? 10 : 0) + centerRank(lane);
        if (!best || score < best.score) best = { lane, slot, score, cut: false };
        break;
      }
    }
    // 名札の入る席が無い（席を保つときは、ほかの名札を切らない）：名札を出さない光にする
    if (!best || (prev && best.score >= 60000)) {
      pendDots.push(node);
      continue;
    }
    const sx = xOf(column, best.slot);
    if (best.cut) {
      for (const l of lightsIn[best.lane]) {
        if (l.pinned && l.x < sx && l.reach + LABEL_CLEAR > sx) l.reach = sx - LABEL_CLEAR;
      }
    }
    const room = roomAt(best.lane, sx, node.key);
    const reach = sx + LABEL_GAP + chooseLabel(measure(node), room, fontSize).width;
    add(best.lane, { key: node.key, x: sx, pinned: true, reach });
    seats.set(node.key, { column, lane: best.lane, slot: best.slot });
    pinnedKeys.add(node.key);
    pinnedCount[column] += 1;
  }

  // 名札を出さない光：人間（名札が入らなかった物）→ 失敗 → AI → 待機。席の左から、レーンの真ん中から埋める
  const WHO_RANK: Record<FlowWho, number> = { human: 0, fail: 1, ai: 2, queue: 3, done: 4 };
  pendDots.sort((a, b) => colOf(a) - colOf(b) || WHO_RANK[a.who] - WHO_RANK[b.who]);
  for (const node of pendDots) {
    const column = colOf(node);
    const prevLane = prev?.seats.get(node.key)?.lane ?? -1;
    let best: { lane: number; slot: number; score: number } | null = null;
    for (let lane = 0; lane < lanes; lane++) {
      for (let slot = 0; slot < capacity; slot++) {
        if (blocked(lane, xOf(column, slot))) continue;
        const score = (prev ? (lane === prevLane ? 0 : 1000) : 0) + slot * 100 + centerRank(lane);
        if (!best || score < best.score) best = { lane, slot, score };
        break;
      }
    }
    if (!best) {
      if (prev) return null;
      hidden.push(node.key);
      continue;
    }
    add(best.lane, { key: node.key, x: xOf(column, best.slot), pinned: false, reach: -Infinity });
    seats.set(node.key, { column, lane: best.lane, slot: best.slot });
  }

  // 3. 名札の幅と位置
  const placed: PlacedNode[] = [];
  const pinnedRects: Rect[] = [];
  for (const node of rest) {
    const seat = seats.get(node.key);
    if (!seat || !pinnedKeys.has(node.key)) continue;
    const x = xOf(seat.column, seat.slot);
    const light = lightsIn[seat.lane].find((l) => l.key === node.key);
    const limit = light ? light.reach - (x + LABEL_GAP) : Infinity;
    const room = Math.min(limit, roomAt(seat.lane, x, node.key));
    const { variant, width: w } = chooseLabel(measure(node), room, fontSize);
    const y = laneYs[seat.lane];
    placed.push({ key: node.key, x, y, column: seat.column, pinned: true, lane: seat.lane, slot: seat.slot, width: w, variant, dx: LABEL_GAP, dy: -lh / 2 });
    pinnedRects.push({ x0: x + LABEL_GAP, x1: x + LABEL_GAP + w, y0: y - lh / 2, y1: y + lh / 2 });
  }
  for (const node of rest) {
    const seat = seats.get(node.key);
    if (!seat || pinnedKeys.has(node.key)) continue;
    const x = xOf(seat.column, seat.slot);
    const y = laneYs[seat.lane];
    const box = hoverLabelBox(x, y, measure(node), { fontSize, height, rightEdge, avoid: pinnedRects });
    placed.push({ key: node.key, x, y, column: seat.column, pinned: false, lane: seat.lane, slot: seat.slot, ...box });
  }

  // 4. 公開済みの塊：右の余白の真ん中。名札のかかっていないレーン（前と同じレーンを優先）
  let cluster: DoneCluster | null = null;
  if (done.length > 0) {
    const cx = width + Math.max(8, overhang * 0.45);
    const m = input.clusterMetrics ?? measure(done[0]);
    // 塊の名札（乗せたとき）が同じレーンの左に入るよう、右端から名札の幅ぶんに常に出す名札が無いレーンを選ぶ
    const want = wants(m, fontSize);
    const needFull = Math.min(want.full, fontSize * MAX_LABEL_EM) + LABEL_GAP * 2;
    const need = Math.min(want.stack, fontSize * MAX_LABEL_EM) + LABEL_GAP * 2;
    const clearOf = (lane: number, from: number) =>
      !pinnedRects.some((r) => r.x1 + SLOT_CLEAR > from && laneYs[lane] > r.y0 && laneYs[lane] < r.y1) &&
      !lightsIn[lane].some((l) => Math.abs(l.x - cx) < MIN_SEP * 2);
    const prevLane = prev?.clusterLane ?? null;
    const pick = (from: number) =>
      prevLane !== null && prevLane < lanes && clearOf(prevLane, from) ? prevLane : order.find((l) => clearOf(l, from));
    const lane = pick(cx - needFull) ?? pick(cx - need) ?? pick(cx - 6) ?? order[0];
    const y = laneYs[lane];
    const box = hoverLabelBox(cx, y, m, { fontSize, height, rightEdge, avoid: pinnedRects });
    cluster = { keys: done.map((n) => n.key), x: cx, y, lane, ...box };
  }

  return {
    placed,
    hidden,
    cluster,
    columnWidth,
    laneHeight: laneHeightOf(fontSize),
    lanes,
    laneYs,
    next: { seats, lanes, gap, clusterLane: cluster?.lane ?? null },
  };
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
