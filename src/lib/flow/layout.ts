import type { FlowNode, FlowWho } from "./nodes";

/**
 * 流れ（PC）の配置：Issue の光を段階の列に置き、名札が隣と重ならないようレーン（行）に詰める。
 * 入力から出力が決まる純粋関数。文字の幅は呼ぶ側が測って渡す（canvas の measureText など）。
 * 寸法の決まりは docs/design.md の「流れ」
 */

/** 名札の出し方：リポジトリ名つき／リポジトリ名なし／1行だけ（公開済み：`#12 公開済み`） */
export type LabelVariant = "full" | "noRepo" | "compact";

/** 名札の2行の文字の幅（px）。compact は line2 を使わない */
export type LabelMetrics = { line1: number; line2: number };

export type MeasureLabel = (node: FlowNode, variant: LabelVariant) => LabelMetrics;

export type LayoutInput = {
  nodes: FlowNode[];
  /** 流れの幅（px）。左端が 0 */
  width: number;
  /** レーンに使える高さ（px） */
  height: number;
  /** 名札の文字の大きさ（px） */
  fontSize: number;
  measure: MeasureLabel;
};

export type PlacedNode = {
  key: string;
  /** 光の中心（px） */
  x: number;
  y: number;
  /** 名札を光の左に出す（右端に入らないとき） */
  flip: boolean;
  /** 名札の幅（px） */
  width: number;
  variant: LabelVariant;
  lane: number;
};

/** 公開済みをまとめた1つの光（名札が入らないときだけ） */
export type DeployedCluster = {
  keys: string[];
  count: number;
  x: number;
  y: number;
  lane: number;
};

export type FlowLayout = {
  placed: PlacedNode[];
  cluster: DeployedCluster | null;
  /** レーンの高さ（px） */
  laneHeight: number;
  /** 名札が横に使ってよい列の数（3→2→1） */
  span: number;
  columnWidth: number;
};

/** 光の中心の、列の左端からの位置 */
export const DOT_OFFSET = 26;
/** 光と名札の間（右に出すとき） */
export const LABEL_GAP = 18;
/** 光と名札の間（左に出すとき） */
export const LABEL_GAP_FLIP = 19;
/** 名札どうしの最低の間 */
const LABEL_MARGIN = 6;
/** 名札の左右の余白（文字の幅に足す） */
export const LABEL_PADDING = 12;
/** レーンの高さの上限（間延びさせない） */
const MAX_LANE_HEIGHT = 72;
/** 公開済みをまとめるのは、この数以上あるとき */
const CLUSTER_MIN = 2;

/** 名札の最小のレーンの高さ（2行ぶん） */
export function minLaneHeight(fontSize: number): number {
  return fontSize * 2.5 + 4;
}

type Slot = { lane: number; x0: number; x1: number };

function overlaps(slots: Slot[], lane: number, x0: number, x1: number): boolean {
  return slots.some((s) => s.lane === lane && s.x0 < x1 + LABEL_MARGIN && s.x1 > x0 - LABEL_MARGIN);
}

/** 名札の幅と出し方を決める：入る範囲で リポジトリ名つき → なし → 切る */
export function chooseVariant(
  node: FlowNode,
  maxWidth: number,
  measure: MeasureLabel,
): { variant: LabelVariant; width: number } {
  if (node.who === "done") {
    const m = measure(node, "compact");
    return { variant: "compact", width: Math.min(maxWidth, Math.ceil(m.line1) + LABEL_PADDING + 6) };
  }
  for (const variant of ["full", "noRepo"] as const) {
    const m = measure(node, variant);
    const need = Math.ceil(Math.max(m.line1, m.line2)) + LABEL_PADDING;
    if (need <= maxWidth) return { variant, width: need };
  }
  return { variant: "noRepo", width: maxWidth };
}

/** 真ん中から外へ、近い順にレーンを試す */
function laneCandidates(desired: number, lanes: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < lanes; d++) {
    const below = desired + d;
    const above = desired - d;
    if (below < lanes && below >= 0) out.push(below);
    if (d > 0 && above >= 0 && above < lanes) out.push(above);
  }
  return out;
}

type Attempt = { placed: PlacedNode[]; lanesUsed: number; minLane: number };

function attempt(
  nodes: FlowNode[],
  width: number,
  columnWidth: number,
  span: number,
  lanes: number,
  measure: MeasureLabel,
  fontSize: number,
  /** 右端の、公開済みを積む帯の幅（積まないときは 0） */
  zone: number,
): Attempt {
  const columns: FlowNode[][] = Array.from({ length: 8 }, () => []);
  for (const node of nodes) columns[Math.min(7, Math.max(0, node.at))].push(node);
  const maxLabel = span * columnWidth - DOT_OFFSET - LABEL_GAP - 2;
  const slots: Slot[] = [];
  const placed: PlacedNode[] = [];
  const center = (lanes - 1) / 2;
  columns.forEach((column, k) => {
    column.forEach((node, index) => {
      const { variant: labelVariant, width: labelWidth } = chooseVariant(node, Math.max(40, maxLabel), measure);
      let x = k * columnWidth + DOT_OFFSET;
      let flip = false;
      let w = labelWidth;
      let variant = labelVariant;
      // 右端の帯（公開済みを積む所）には、公開の列の物以外の名札を入れない
      const limit = k === 7 ? width : width - zone;
      if (x + LABEL_GAP + w > limit) {
        const room = limit - x - LABEL_GAP;
        if (room >= fontSize * 22 + 10 && node.who !== "done") {
          // 読める幅が残っていれば、縮めて切る
          const shrunk = chooseVariant(node, room, measure);
          w = shrunk.width;
          variant = shrunk.variant;
        } else if (k === 7) {
          // 公開の列：光を右端に置いて、名札を左へ
          flip = true;
          x = width - DOT_OFFSET;
        } else {
          // それ以外の列：光はそのまま、名札だけ左へ
          flip = true;
        }
      }
      const x0 = flip ? x - LABEL_GAP_FLIP - w : x - 12;
      const x1 = flip ? x + 12 : x + LABEL_GAP + w;
      const desired = Math.round(center - (column.length - 1) / 2 + index);
      let lane = laneCandidates(Math.min(lanes - 1, Math.max(0, desired)), lanes).find(
        (candidate) => !overlaps(slots, candidate, x0, x1),
      );
      if (lane === undefined) {
        // どのレーンにも入らない：下に増やす（あとで高さが足りなければ span を減らす）
        lane = lanes;
        while (overlaps(slots, lane, x0, x1)) lane++;
      }
      slots.push({ lane, x0, x1 });
      placed.push({ key: node.key, x, y: 0, flip, width: w, variant, lane });
    });
  });
  const laneNumbers = placed.map((p) => p.lane);
  const minLane = laneNumbers.length ? Math.min(...laneNumbers) : 0;
  const maxLane = laneNumbers.length ? Math.max(...laneNumbers) : -1;
  return { placed, lanesUsed: maxLane - minLane + 1, minLane };
}

/** 公開済みを1つにまとめた光（名札は `公開済み N件`） */
export function clusterNode(dones: FlowNode[]): FlowNode {
  const first = dones[0];
  return {
    key: "cluster:deployed",
    owner: first.owner,
    repo: first.repo,
    number: 0,
    title: dones.map((d) => `#${d.number}`).join(" "),
    url: first.url,
    at: 7,
    who: "done",
    label: `公開済み ${dones.length}件`,
    caption: dones.map((d) => `#${d.number} ${d.title}`).join("　"),
    deployLinks: [],
    logUrl: null,
    turn: false,
  };
}

/** 公開済みの名札（1行）の縦の間隔 */
export function doneLaneHeight(fontSize: number): number {
  return fontSize * 1.25 + 6;
}

/** 公開済みが右端に縦に並ぶ帯の幅（名札の最大の幅 ＋ 光と余白） */
function doneZoneWidth(dones: FlowNode[], measure: MeasureLabel): number {
  const widest = Math.max(0, ...dones.map((d) => chooseVariant(d, 400, measure).width));
  return widest + DOT_OFFSET + LABEL_GAP_FLIP + LABEL_MARGIN;
}

/**
 * 公開済みを右端に縦に積む（名札は1行）。ほかの名札が右端の帯にかかる所は避ける。
 * 全部置けなければ null（まとめる）
 */
function stackDones(
  dones: FlowNode[],
  placed: PlacedNode[],
  width: number,
  height: number,
  fontSize: number,
  laneHeight: number,
  measure: MeasureLabel,
): PlacedNode[] | null {
  if (dones.length === 0) return [];
  const zone = doneZoneWidth(dones, measure);
  const step = doneLaneHeight(fontSize);
  const blocked = placed
    .filter((p) => {
      const x1 = p.flip ? p.x + 12 : p.x + LABEL_GAP + p.width;
      return x1 > width - zone;
    })
    .map((p) => [p.y - laneHeight / 2, p.y + laneHeight / 2] as const);
  const out: PlacedNode[] = [];
  let y = step / 2;
  for (const node of dones) {
    // ふさがっている区間を飛ばす（浮動小数の誤差で同じ区間に戻らないよう、少し余裕をとる）
    for (;;) {
      const hit = blocked.find(([a, b]) => y + step / 2 > a + 0.01 && y - step / 2 < b - 0.01);
      if (!hit) break;
      y = hit[1] + step / 2 + 0.05;
    }
    if (y + step / 2 > height + 0.5) return null;
    const { width: w, variant } = chooseVariant(node, zone, measure);
    out.push({ key: node.key, x: width - DOT_OFFSET, y, flip: true, width: w, variant, lane: -1 });
    y += step;
  }
  return out;
}

/**
 * 流れの配置を決める。公開済み以外をレーンに詰め、公開済みは右端に縦に積む。
 * レーンが高さに入らなければ名札の幅（span）を 3→2→1 と縮め、公開済みが積めなければ1つにまとめる
 */
export function layoutFlow(input: LayoutInput): FlowLayout {
  const { nodes, width, height, fontSize, measure } = input;
  const columnWidth = width / 8;
  const minLH = minLaneHeight(fontSize);
  const lanes = Math.max(1, Math.floor(height / minLH));
  const dones = nodes.filter((n) => n.who === "done");
  const others = nodes.filter((n) => n.who !== "done");
  const canCluster = dones.length >= CLUSTER_MIN;

  type Candidate = { span: number; clustered: boolean; placed: PlacedNode[]; laneHeight: number; ok: boolean };
  const candidates: Candidate[] = [];
  for (const span of [3, 2, 1]) {
    for (const clustered of [false, true]) {
      if (clustered && !canCluster) continue;
      const stacking = !clustered && dones.length >= CLUSTER_MIN;
      const list = clustered ? [...others, clusterNode(dones)] : stacking ? others : nodes;
      const zone = stacking ? doneZoneWidth(dones, measure) : 0;
      const result = attempt(list, width, columnWidth, span, lanes, measure, fontSize, zone);
      const { placed, lanesUsed, minLane } = result;
      const fitsLanes = lanesUsed * minLH <= height + 0.5;
      const laneHeight = Math.max(
        minLH * 0.85,
        Math.min(MAX_LANE_HEIGHT, lanesUsed > 0 ? height / lanesUsed : MAX_LANE_HEIGHT),
      );
      const y0 = Math.max(0, (height - lanesUsed * laneHeight) / 2);
      for (const p of placed) p.y = y0 + (p.lane - minLane) * laneHeight + laneHeight / 2;
      let ok = fitsLanes;
      let all = placed;
      if (stacking) {
        const stacked = stackDones(dones, placed, width, height, fontSize, laneHeight, measure);
        if (stacked) all = [...placed, ...stacked];
        else ok = false;
      }
      candidates.push({ span, clustered, placed: all, laneHeight, ok });
    }
  }
  // 題名が読める幅（22文字ぶん）があれば、まとめない方を選ぶ。無ければ、入る中でいちばん広い物
  const readable = (c: Candidate) => c.span * columnWidth - DOT_OFFSET - LABEL_GAP - 2 >= fontSize * 22 + 10;
  const fitting = candidates.filter((c) => c.ok);
  const pick =
    fitting.find((c) => !c.clustered && readable(c)) ??
    fitting.find((c) => readable(c)) ??
    fitting.find((c) => !c.clustered) ??
    fitting[0] ??
    candidates[candidates.length - 1];

  let cluster: DeployedCluster | null = null;
  if (pick.clustered) {
    const c = pick.placed.find((p) => p.key === "cluster:deployed");
    if (c) cluster = { keys: dones.map((d) => d.key), count: dones.length, x: c.x, y: c.y, lane: c.lane };
  }
  return { placed: pick.placed, cluster, laneHeight: pick.laneHeight, span: pick.span, columnWidth };
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
