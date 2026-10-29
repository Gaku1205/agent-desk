import {
  DOT_OFFSET,
  FOOT_ROOM,
  layoutFlow,
  stripColumns,
  type LabelVariant,
  type MeasureLabel,
} from "@/lib/flow/layout";
import type { FlowNode, FlowWho } from "@/lib/flow/nodes";
import { seededRandom, seedOf } from "@/lib/flow/random";
import { squeezeTowardLabel } from "@/lib/flow/squeeze";

/**
 * 流れの映像（docs/design.md の「映像」「流れ（PC）」「動き」）。
 * 画面全体の canvas に、川（背景の粒）・Issue の光と粒・止まった霧を描き、名札（HTML）を光に追従させる。
 * 巨大な数字の中の粒も、同じ川の式で動かす。川の粒が数字を通ると灯り、灯ったまま流れていく（生きている映像は1系統だけ）。
 * データの判定はしない。もらった FlowNode を置いて描くだけ
 */

/** 色（RGB）。CSS の --you --ai --q --fail --done と同じ */
export const WHO_RGB: Record<FlowWho, string> = {
  human: "245,167,58",
  ai: "91,141,255",
  queue: "155,124,245",
  fail: "242,92,92",
  done: "77,211,154",
};

export const WHO_CSS: Record<FlowWho, string> = {
  human: "var(--you)",
  ai: "var(--ai)",
  queue: "var(--q)",
  fail: "var(--fail)",
  done: "var(--done)",
};

/** 川の速さ（px/秒）と、ノイズで横に揺れる強さ */
const RIVER_SPEED = 24;
const RIVER_AMP = 12;
/** 光の移動のばね（docs/design.md） */
const SPRING_K = 140;
const SPRING_C = 20;
/** 段階の目盛りの高さ（光の区域の上）と、下端の行（説明と凡例） */
const STAGES_H = 30;
/** 灯った粒が冷める速さ（1/秒） */
const HEAT_DECAY = 0.7;
/** 数字の左から入って右へ抜ける流れ（数字の高さの帯だけ）：数字の左何pxから、右何pxまで */
const CURRENT_IN = 60;
const CURRENT_OUT = 90;
/** 飛んでいる光が、段階が変わらないまま戻るまで */
const FLY_MS = 8000;
/** 飛んでいる光が尾を残す速さ（px/秒）と、尾の長さ（秒） */
const TRAIL_SPEED = 60;
const TRAIL_LIFE = 0.45;
const TRAIL_MAX = 40;

type ParticleType = "orbit" | "comet" | "exit" | "wide" | "still";

type Particle = {
  type: ParticleType;
  a: number;
  r: number;
  w: number;
  ph: number;
  p: number;
  s: number;
  off: number;
  len: number;
  sp: number;
  spawned: boolean;
};

type TrailDot = { u: number; v: number; a: number };

type Body = {
  node: FlowNode;
  /** 目標の位置（流れの中の座標） */
  u: number;
  v: number;
  /** 今の位置と速さ（ばね） */
  pu: number;
  pv: number;
  vu: number;
  vv: number;
  parts: Particle[];
  seededFor: string;
  hl: number;
  hlT: number;
  on: boolean;
  /** 名札を常に出す（人間の番・失敗） */
  pinned: boolean;
  width: number;
  variant: LabelVariant;
  /** 名札の左上の、光からの位置 */
  dx: number;
  dy: number;
  /** 公開済みの粒が抜けて消える所（列の右端。流れの中の座標） */
  edgeU: number;
  fresh: boolean;
  lastX: number;
  lastY: number;
  rand: () => number;
  /** スマホの帯のまとまり（件数ぶんの小さな芯） */
  count: number;
  /** 押したときに飛んで行く先（null なら配置どおり） */
  flyU: number | null;
  flyUntil: number;
  trail: TrailDot[];
};

type RiverParticle = { x: number; y: number; s: number; ph: number; sp: number; heat: number; vx: number; vy: number };

/** スマホの帯で、押した Issue の段階から次の段階へ飛ぶ光 */
type Spark = { u0: number; v0: number; u1: number; v1: number; t0: number; who: FlowWho; trail: TrailDot[] };

export type EngineElements = {
  river: HTMLCanvasElement;
  /** 止まった霧を背景に敷く要素（body）。霧は1回だけ描いて背景の画像にする（重ねる層を増やさない） */
  fog: HTMLElement;
  /** 流れの場所（PC：段階の列の面、スマホ：細い帯）。無ければ川だけ描く */
  flow: HTMLElement | null;
  /** 名札の容れ物（PC） */
  nodes: HTMLElement | null;
  /** 誌面（この上端より下は粒を暗くする） */
  band: HTMLElement | null;
};

export type GiantElements = { canvas: HTMLCanvasElement; ghost: HTMLElement };

export type EngineOptions = {
  isReduced: () => boolean;
  isMobile: () => boolean;
  /** 名札の文字の大きさ（px）。PC だけ */
  labelFontSize: () => number;
  /** スマホの帯で、列の中心の x（帯の中の座標）を返す */
  stripCenters: () => number[] | null;
};

function makeSprite(rgb: string, size: number, soft: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(soft ? 0.25 : 0.55, `rgba(${rgb},${soft ? 0.5 : 0.9})`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** 整数の格子のハッシュ（ノイズ用） */
function hsh(ix: number, iy: number): number {
  let n = (ix * 374761393 + iy * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) & 0xffff) / 0xffff;
}

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hsh(ix, iy);
  const b = hsh(ix + 1, iy);
  const c = hsh(ix, iy + 1);
  const d = hsh(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** ノイズの curl（発散しない流れ） */
function curl(x: number, y: number, t: number): [number, number] {
  const s = 1 / 260;
  const e = 2;
  const n = (px: number, py: number) =>
    vnoise(px * s + t * 0.03, py * s + t * 0.02) + 0.5 * vnoise(px * s * 2.1 + 7 - t * 0.02, py * s * 2.1 + 3);
  const dx = (n(x + e, y) - n(x - e, y)) / (2 * e);
  const dy = (n(x, y + e) - n(x, y - e)) / (2 * e);
  return [dy, -dx];
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);

export class FlowEngine {
  private el: EngineElements;
  private opt: EngineOptions;
  private rctx: CanvasRenderingContext2D;
  private fctx: CanvasRenderingContext2D;
  private bodies = new Map<string, Body>();
  private labels = new Map<string, HTMLElement>();
  private nodes: FlowNode[] = [];
  private river: RiverParticle[] = [];
  private sparks: Spark[] = [];
  private sprites: Record<string, HTMLCanvasElement> = {};
  private W = 0;
  private H = 0;
  private DPR = 1;
  private t = 0;
  private last = 0;
  private raf = 0;
  private fogDirty = true;
  private fogCanvas: HTMLCanvasElement = document.createElement("canvas");
  private dirty = true;
  private mobile = false;
  private flowRect = { left: 0, top: 0, width: 0, height: 0 };
  private gutter = 0;
  private columnWidth = 0;
  private scale = 1;
  private labelFs = 12;
  private labelFamily = "sans-serif";
  /** 流れに2つ以上のリポジトリの Issue がある（名札にリポジトリ名が要る） */
  private multiRepo = false;
  private giantFamily = "sans-serif";
  private bandTop = Infinity;
  private riverRand = seededRandom(7);
  private meas: CanvasRenderingContext2D | null = null;
  private strip: { x: number; count: number; whos: FlowWho[]; lead: FlowWho | null; keys: string[] }[] = [];
  private stripHl = -1;
  /** 巨大な数字 */
  private giant: GiantElements | null = null;
  private gBase: HTMLCanvasElement = document.createElement("canvas");
  private gField: HTMLCanvasElement = document.createElement("canvas");
  private gTmp: HTMLCanvasElement = document.createElement("canvas");
  private gValue = 0;
  private gPrev: number | null = null;
  private gRoll = 1;
  private gRollT0 = 0;
  private gW = 0;
  private gH = 0;
  private gDpr = 1;
  private gFs = 0;
  private gReady = false;
  private gMetrics: { asc: number; left: number } | null = null;
  /** 数字の形の型（1倍の大きさ。1 = 数字の中） */
  private gMask: Uint8Array | null = null;
  private gLocal: RiverParticle[] = [];
  /** 数字の高さの帯を、数字の左から入って右へ抜ける川の粒（数字に対する位置） */
  private gCurrent: RiverParticle[] = [];
  private gRand = seededRandom(11);
  private onScroll = () => {
    this.dirty = true;
  };
  private onResize = () => {
    this.resize();
  };

  constructor(elements: EngineElements, options: EngineOptions) {
    this.el = elements;
    this.opt = options;
    this.rctx = elements.river.getContext("2d") as CanvasRenderingContext2D;
    this.fctx = this.fogCanvas.getContext("2d") as CanvasRenderingContext2D;
    this.meas = document.createElement("canvas").getContext("2d");
    this.resize();
    addEventListener("resize", this.onResize);
    addEventListener("scroll", this.onScroll, { passive: true });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    if (typeof document.fonts?.ready?.then === "function") {
      void document.fonts.ready.then(() => {
        this.layout(false);
        this.dirty = true;
      });
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const prop of ["background-image", "background-size", "background-attachment", "background-repeat"]) {
      this.el.fog.style.removeProperty(prop);
    }
    removeEventListener("resize", this.onResize);
    removeEventListener("scroll", this.onScroll);
  }

  /** 名札の要素を登録する（React が描いた物） */
  setLabel(key: string, element: HTMLElement | null) {
    if (element) this.labels.set(key, element);
    else this.labels.delete(key);
    const b = this.bodies.get(key);
    if (b && element) {
      b.lastX = NaN;
      this.applyLabel(b, element);
    }
    this.dirty = true;
  }

  /** 流れに出す Issue を入れ替える。animate なら、段階が変わった光が前の位置から流れて移る */
  setNodes(nodes: FlowNode[], animate: boolean) {
    this.nodes = nodes;
    this.multiRepo = new Set(nodes.map((n) => `${n.owner}/${n.repo}`)).size > 1;
    const keys = new Set(nodes.map((n) => n.key));
    for (const key of this.bodies.keys()) if (!key.startsWith("strip:") && !keys.has(key)) this.bodies.delete(key);
    this.layout(animate);
    this.dirty = true;
  }

  /** 行に乗せた Issue の光を強める */
  highlight(key: string | null) {
    for (const b of this.bodies.values()) b.hlT = b.node.key === key ? 1 : 0;
    this.dirty = true;
  }

  /** スマホの帯の列を強める */
  highlightStrip(at: number) {
    this.stripHl = at;
    this.dirty = true;
  }

  /**
   * ボタンを押した：その光が、操作のあとの段階の列（column）まで飛んで行く。
   * 同じ列なら上へ跳ねて戻る。取り直しで段階か誰の番が変わるか、land・8秒で配置どおりに戻る
   */
  fly(key: string, column: number) {
    const node = this.nodes.find((n) => n.key === key);
    if (!node) return;
    const reduced = this.opt.isReduced();
    if (this.mobile) {
      const from = this.strip[node.at];
      const to = this.strip[column];
      if (!from || !to || reduced) return;
      const v = Math.max(18, this.flowRect.height * 0.34);
      this.sparks.push({ u0: from.x, v0: v, u1: to.x, v1: v, t0: performance.now(), who: node.who, trail: [] });
      this.dirty = true;
      return;
    }
    const b = this.bodies.get(key);
    if (!b) return;
    for (let k = 0; k < 12; k++) b.parts.push(this.mkPart(b, "comet", true));
    if (column === node.at) {
      if (!reduced) b.vv -= 220;
    } else {
      b.flyU = this.gutter + column * this.columnWidth + DOT_OFFSET;
      b.flyUntil = performance.now() + FLY_MS;
      if (reduced) {
        b.pu = b.flyU;
        b.vu = 0;
      }
      this.labels.get(key)?.setAttribute("data-fly", "");
    }
    this.dirty = true;
  }

  /** 飛ばした光を、配置どおりの位置へ戻す（操作が失敗したとき） */
  land(key: string) {
    const b = this.bodies.get(key);
    if (!b || b.flyU === null) return;
    b.flyU = null;
    this.labels.get(key)?.removeAttribute("data-fly");
    this.dirty = true;
  }

  /** 巨大な数字の canvas を登録する */
  setGiant(elements: GiantElements | null) {
    this.giant = elements;
    this.gReady = false;
    this.gMask = null;
    if (!elements) return;
    this.giantFamily = getComputedStyle(elements.ghost).fontFamily || "sans-serif";
    const load =
      typeof document.fonts?.load === "function"
        ? document.fonts.load(`800 100px ${this.giantFamily}`).catch(() => [])
        : Promise.resolve();
    void Promise.resolve(load).then(() => {
      if (this.giant !== elements) return;
      this.gReady = true;
      this.giantLayout();
      this.dirty = true;
    });
  }

  /** 数字を変える（転がる） */
  setGiantValue(n: number) {
    if (n === this.gValue) return;
    if (!this.gReady) {
      this.gValue = n;
      return;
    }
    this.gPrev = this.gValue;
    this.gValue = n;
    if (this.opt.isReduced()) {
      this.gRoll = 1;
    } else {
      this.gRoll = 0;
      this.gRollT0 = performance.now();
    }
    this.giantLayout();
    this.dirty = true;
  }

  /** 画面の大きさが変わった */
  resize() {
    this.DPR = Math.min(devicePixelRatio || 1, 1.5);
    this.W = innerWidth;
    this.H = innerHeight;
    const { river } = this.el;
    const fog = this.fogCanvas;
    river.width = Math.round(this.W * this.DPR);
    river.height = Math.round(this.H * this.DPR);
    this.rctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    fog.width = Math.ceil(this.W / 4);
    fog.height = Math.ceil(this.H / 4);
    this.fogDirty = true;
    for (const who of Object.keys(WHO_RGB) as FlowWho[]) {
      this.sprites[who] = makeSprite(WHO_RGB[who], 16, false);
      this.sprites[`${who}_glow`] = makeSprite(WHO_RGB[who], 64, true);
    }
    this.sprites.river = makeSprite("150,165,205", 12, false);
    this.sprites.amber = makeSprite("255,196,96", 12, false);
    this.seedRiver();
    this.layout(false);
    if (this.gReady) this.giantLayout();
    this.dirty = true;
  }

  private seedRiver() {
    const n = this.opt.isMobile() ? 220 : Math.round(Math.min(900, (this.W * this.H) / 1800));
    this.riverRand = seededRandom(7);
    const r = this.riverRand;
    this.river = [];
    for (let k = 0; k < n; k++) {
      this.river.push({ x: r() * this.W, y: r() * this.H, s: 0.5 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 0.8, heat: 0, vx: 0, vy: 0 });
    }
  }

  private idText(node: FlowNode): string {
    return `${this.multiRepo ? node.repo : ""}#${node.number}`;
  }

  private measure: MeasureLabel = (node) => {
    const m = this.meas;
    if (!m) return { id: 0, status: 0, title: 0 };
    const fs = this.labelFs;
    m.font = `400 ${fs * 0.92}px ${this.labelFamily}`;
    const id = m.measureText(this.idText(node)).width;
    m.font = `500 ${fs}px ${this.labelFamily}`;
    const status = m.measureText(node.label).width;
    m.font = `400 ${fs * 0.96}px ${this.labelFamily}`;
    const title = m.measureText(node.title).width;
    return { id, status, title };
  };

  /** 光の位置を決める（PC：段階の列の中、スマホ：段階ごとに1つ） */
  private layout(animate: boolean) {
    this.mobile = this.opt.isMobile();
    const flow = this.el.flow;
    if (!flow) {
      this.flowRect = { left: 0, top: 0, width: 0, height: 0 };
      return;
    }
    const r = flow.getBoundingClientRect();
    this.flowRect = { left: r.left, top: r.top + scrollY, width: r.width, height: r.height };
    if (this.mobile) {
      this.layoutStrip(animate);
      return;
    }
    this.strip = [];
    for (const key of [...this.bodies.keys()]) if (key.startsWith("strip:")) this.bodies.delete(key);
    const gutter = parseFloat(getComputedStyle(flow).paddingLeft) || 0;
    this.gutter = gutter;
    const width = r.width - gutter * 2;
    const height = Math.max(40, r.height - STAGES_H - FOOT_ROOM);
    this.labelFs = this.opt.labelFontSize();
    if (this.el.nodes) this.labelFamily = getComputedStyle(this.el.nodes).fontFamily || "sans-serif";
    const layout = layoutFlow({
      nodes: this.nodes,
      width,
      height,
      fontSize: this.labelFs,
      overhang: gutter,
      measure: this.measure,
    });
    this.columnWidth = layout.columnWidth;
    this.scale = Math.min(1.5, Math.max(0.9, this.columnWidth / 190));
    const shown = new Set<string>();
    for (const p of layout.placed) {
      const node = this.nodes.find((n) => n.key === p.key);
      if (!node) continue;
      const b = this.place(node, gutter + p.x, STAGES_H + p.y, animate);
      b.pinned = p.pinned;
      b.width = p.width;
      b.variant = p.variant;
      b.dx = p.dx;
      b.dy = p.dy;
      b.edgeU = gutter + (p.column + 1) * this.columnWidth - 4;
      shown.add(p.key);
    }
    for (const [key, b] of this.bodies) {
      b.on = shown.has(key);
      const el = this.labels.get(key);
      if (el) this.applyLabel(b, el);
    }
    for (const [key, el] of this.labels) if (!shown.has(key)) el.setAttribute("data-off", "");
  }

  /** 名札の要素に、出し方と位置を渡す */
  private applyLabel(b: Body, el: HTMLElement) {
    el.toggleAttribute("data-off", !b.on);
    el.toggleAttribute("data-pin", b.pinned);
    el.toggleAttribute("data-fly", b.flyU !== null);
    el.setAttribute("data-variant", b.variant);
    el.style.setProperty("--w", `${b.width}px`);
    el.style.setProperty("--tx", `${b.dx}px`);
    el.style.setProperty("--ty", `${b.dy}px`);
  }

  /** スマホ：段階ごとに1つの光。列の中心は帯の中の x */
  private layoutStrip(animate: boolean) {
    const centers = this.opt.stripCenters();
    const columns = stripColumns(this.nodes);
    const v = Math.max(18, this.flowRect.height * 0.34);
    const colW = this.flowRect.width / 8;
    this.strip = [];
    const shown = new Set<string>();
    columns.forEach((column, k) => {
      const x = centers?.[k] ?? (k + 0.5) * colW;
      this.strip.push({ x, count: column.count, whos: column.whos, lead: column.lead, keys: column.keys });
      if (column.count === 0 || !column.lead) return;
      const key = `strip:${k}`;
      const node: FlowNode = {
        key,
        owner: "",
        repo: "",
        number: k,
        title: "",
        url: "",
        at: k,
        who: column.lead,
        label: "",
        caption: "",
        deployLinks: [],
        logUrl: null,
        turn: false,
      };
      const b = this.place(node, x, v, animate);
      b.count = column.count;
      b.pinned = true;
      b.edgeU = x + colW / 2 - 2;
      shown.add(key);
    });
    for (const [key, b] of this.bodies) b.on = shown.has(key);
    for (const el of this.labels.values()) el.setAttribute("data-off", "");
    this.scale = 1;
  }

  private place(node: FlowNode, u: number, v: number, animate: boolean): Body {
    let b = this.bodies.get(node.key);
    if (!b) {
      b = this.makeBody(node);
      this.bodies.set(node.key, b);
    }
    const moved = b.node.at !== node.at;
    if (b.flyU !== null && (moved || b.node.who !== node.who)) {
      // 取り直しで段階が変わった：飛んでいた先から、新しい配置へそのまま流れる
      b.flyU = null;
    }
    b.u = u;
    b.v = v;
    if (!animate || this.opt.isReduced() || b.fresh) {
      b.pu = u;
      b.pv = v;
      b.vu = b.vv = 0;
      b.fresh = false;
    } else if (moved) {
      b.vu += 60;
    }
    b.node = node;
    return b;
  }

  private makeBody(node: FlowNode): Body {
    const b: Body = {
      node,
      u: 0,
      v: 0,
      pu: 0,
      pv: 0,
      vu: 0,
      vv: 0,
      parts: [],
      seededFor: "",
      hl: 0,
      hlT: 0,
      on: true,
      pinned: false,
      width: 120,
      variant: "full",
      dx: 0,
      dy: 0,
      edgeU: 0,
      fresh: true,
      lastX: NaN,
      lastY: NaN,
      rand: seededRandom(seedOf(node.key)),
      count: 1,
      flyU: null,
      flyUntil: 0,
      trail: [],
    };
    return b;
  }

  private mkPart(b: Body, type: ParticleType, spawn: boolean): Particle {
    const r = b.rand;
    const p: Particle = {
      type,
      a: r() * Math.PI * 2,
      r: 0,
      w: 0,
      ph: r() * Math.PI * 2,
      p: spawn ? 0 : r(),
      s: 0.7 + r() * 0.9,
      off: r() - 0.5,
      len: 0,
      sp: 0,
      spawned: spawn,
    };
    if (type === "orbit") {
      p.r = 5 + r() * 9;
      p.w = (0.3 + r() * 0.4) * (r() < 0.5 ? 1 : -1);
    } else if (type === "comet") {
      p.len = 34 + r() * 20;
      p.sp = 0.6 + r() * 0.5;
    } else if (type === "exit") {
      p.sp = 0.22 + r() * 0.16;
    } else if (type === "wide") {
      p.r = 10 + r() * 10;
      p.w = (0.12 + r() * 0.15) * (r() < 0.5 ? 1 : -1);
    } else {
      p.r = 4 + r() * 8;
    }
    return p;
  }

  private seedKey(b: Body): string {
    return `${b.node.who}:${b.count > 1 ? b.count : ""}:${b.pinned ? 1 : 0}`;
  }

  private seedParts(b: Body) {
    const who = b.node.who;
    const n = b.count > 1 ? 2.2 : 1;
    // 名札を出さない光は、粒を半分にする
    const f = b.pinned ? 1 : 0.5;
    const mix: [ParticleType, number][] =
      who === "ai"
        ? [
            ["orbit", 12],
            ["comet", 12],
          ]
        : who === "human"
          ? [["orbit", 26]]
          : who === "queue"
            ? [["wide", 16]]
            : who === "fail"
              ? [["still", 16]]
              : [
                  ["orbit", 8 * n],
                  ["exit", 12 * n],
                ];
    b.parts = [];
    for (const [type, count] of mix) {
      for (let m = 0; m < Math.round(count * f); m++) b.parts.push(this.mkPart(b, type, false));
    }
    b.seededFor = this.seedKey(b);
  }

  /** 川の粒を1歩進める（画面の座標）。数字の中の粒も同じ式を使う */
  private flowStep(p: { x: number; y: number; sp: number; vx: number; vy: number }, dt: number, t: number) {
    const c = curl(p.x, p.y, t);
    p.vx = RIVER_SPEED * p.sp + c[0] * RIVER_AMP * 12;
    p.vy = c[1] * RIVER_AMP * 12;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  private toXY(u: number, v: number): [number, number] {
    return [this.flowRect.left + u, this.flowRect.top - scrollY + v];
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const reduced = this.opt.isReduced();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.W !== innerWidth || this.H !== innerHeight) this.resize();
    const rolling = this.gRoll < 1;
    if (reduced && !this.dirty && !rolling) return;
    this.dirty = false;
    if (!reduced) this.t += dt;
    this.draw(now, dt, reduced);
  };

  /** 巨大な数字の、画面の中の位置（無ければ null） */
  private giantRect(): DOMRect | null {
    const g = this.giant;
    if (!g || !this.gReady || !this.gMetrics) return null;
    return g.canvas.getBoundingClientRect();
  }

  private draw(now: number, dt: number, reduced: boolean) {
    const { rctx, W, H, t, sprites } = this;
    const band = this.el.band;
    this.bandTop = band ? band.getBoundingClientRect().top + 30 : Infinity;
    const bandTop = this.bandTop;
    const gRect = this.giantRect();
    const mask = this.gMask;
    const decay = Math.exp(-HEAT_DECAY * dt);
    rctx.clearRect(0, 0, W, H);
    rctx.globalCompositeOperation = "lighter";
    // 川（数字を通った粒は灯り、灯ったまま流れていく）
    for (const p of this.river) {
      if (!reduced) {
        this.flowStep(p, dt, t);
        if (p.x > W + 6) {
          p.x = -6;
          p.y = this.riverRand() * H;
          p.heat = 0;
        }
        if (p.y < -6) p.y = H + 6;
        if (p.y > H + 6) p.y = -6;
        p.heat *= decay;
      }
      // 動きを止めているときは灯さない（スクロールで数字が動いた跡が残らないように）
      if (gRect && mask && !reduced) {
        const lx = Math.floor(p.x - gRect.left);
        const ly = Math.floor(p.y - gRect.top);
        if (lx >= 0 && ly >= 0 && lx < this.gW && ly < this.gH && mask[ly * this.gW + lx] === 1) p.heat = 1;
      }
      const tw = 0.55 + 0.45 * Math.sin(t * 1.1 + p.ph);
      let a = 0.15 * tw;
      if (p.y > bandTop) a *= 0.3;
      if (p.heat > 0.02) {
        rctx.globalAlpha = Math.min(1, a + 0.55 * p.heat);
        const sz = 4 * p.s * (1 + 0.8 * p.heat);
        rctx.drawImage(sprites.amber, p.x - sz / 2, p.y - sz / 2, sz, sz);
        continue;
      }
      rctx.globalAlpha = a;
      const sz = 4 * p.s;
      rctx.drawImage(sprites.river, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    // 光と粒
    const sc = this.mobile ? 1 : this.scale;
    for (const b of this.bodies.values()) {
      if (!b.on) continue;
      const who = b.node.who;
      if (b.seededFor !== this.seedKey(b)) this.seedParts(b);
      if (b.flyU !== null && now > b.flyUntil) this.land(b.node.key);
      const tu = b.flyU ?? b.u;
      if (!reduced) {
        b.vu += (SPRING_K * (tu - b.pu) - SPRING_C * b.vu) * dt;
        b.vv += (SPRING_K * (b.v - b.pv) - SPRING_C * b.vv) * dt;
        b.pu += b.vu * dt;
        b.pv += b.vv * dt;
        if (Math.hypot(b.vu, b.vv) > TRAIL_SPEED) {
          b.trail.push({ u: b.pu, v: b.pv, a: 0.7 });
          if (b.trail.length > TRAIL_MAX) b.trail.shift();
        }
      } else {
        b.pu = tu;
        b.pv = b.v;
      }
      const stripHl = this.mobile && this.stripHl === b.node.at ? 1 : 0;
      b.hl += (Math.max(b.hlT, stripHl) - b.hl) * Math.min(1, dt * 10);
      const [x, y] = this.toXY(b.pu, b.pv);
      if (!this.mobile) this.moveLabel(b);
      this.drawTrail(b.trail, who, dt, bandTop);
      const dim = y > bandTop ? 0.3 : 1;
      const big = b.count > 1 ? 1.3 : 1;
      const quiet = b.pinned ? 1 : 0.7;
      let g = who === "human" ? 0.5 : who === "ai" ? 0.3 : who === "queue" ? 0.18 : who === "fail" ? 0.3 : 0.22;
      g = (g * quiet + b.hl * 0.35) * dim;
      let gr = (who === "human" ? 24 : who === "queue" ? 24 : 18) * sc * big * quiet;
      if (this.mobile) gr *= 0.6;
      gr += b.hl * 10;
      rctx.globalAlpha = g;
      rctx.drawImage(sprites[`${who}_glow`], x - gr, y - gr, gr * 2, gr * 2);
      rctx.globalAlpha = (who === "queue" ? 0.7 : 1) * dim;
      const cs = (who === "human" ? 7.5 : 6) * sc * big;
      if (b.count > 1) {
        for (let c = 0; c < Math.min(b.count, 12); c++) {
          const an = c * 2.4 + 0.6;
          const rr = (6 + c * 3.2) * sc;
          rctx.drawImage(sprites[who], x + Math.cos(an) * rr - 3, y + Math.sin(an) * rr * 0.7 - 3, 6, 6);
        }
      } else {
        rctx.drawImage(sprites[who], x - cs / 2, y - cs / 2, cs, cs);
      }
      for (let k = b.parts.length - 1; k >= 0; k--) {
        const p = b.parts[k];
        let px: number;
        let py: number;
        let a: number;
        if (p.type === "orbit" || p.type === "wide" || p.type === "still") {
          if (!reduced) p.a += p.w * dt;
          const rr = p.r * sc * big * (1 + b.hl * 0.3);
          const jx = p.type === "still" ? Math.sin(t * 9 + p.ph) * 0.8 : 0;
          // 名札の側（光の右）へは張り出さない
          const raw = Math.cos(p.a) * rr + jx;
          const du = this.mobile ? raw : squeezeTowardLabel(raw);
          const dv = Math.sin(p.a) * rr * 0.62;
          [px, py] = this.toXY(b.pu + du, b.pv + dv);
          a = (who === "queue" ? 0.5 : 0.85) * (0.6 + 0.4 * Math.sin(t * 1.6 + p.ph));
        } else if (p.type === "comet") {
          if (!reduced) p.p += dt * p.sp;
          if (p.p >= 1) {
            if (p.spawned) {
              b.parts.splice(k, 1);
              continue;
            }
            p.p = 0;
            p.off = b.rand() - 0.5;
          }
          // 尾は進む向きの後ろ（左）へ流れる。名札（右）の上を通らない
          const du = -p.p * p.len * (this.mobile ? 0.5 : 1);
          const dv = p.off * 14 * (1 - p.p) + Math.sin(p.p * 6 + p.ph) * 2;
          [px, py] = this.toXY(b.pu + du, b.pv + dv);
          a = (1 - p.p) * 0.9;
        } else {
          if (!reduced) p.p += dt * p.sp;
          if (p.p >= 1) {
            p.p = 0;
            p.off = b.rand() - 0.5;
          }
          // 公開済み：列の右端まで抜けて消える（ほかの列に入らない）
          const edge = Math.max(8, b.edgeU - b.pu);
          const du = p.p * p.p * edge;
          const dv = p.off * 18 * big + Math.sin(p.p * 8 + p.ph) * 3;
          [px, py] = this.toXY(b.pu + du, b.pv + dv);
          a = (1 - p.p) * 0.55;
        }
        if (py > bandTop) a *= 0.3;
        rctx.globalAlpha = Math.max(0, a);
        const sz = 3 * p.s * Math.min(1.3, sc);
        rctx.drawImage(sprites[who], px - sz / 2, py - sz / 2, sz, sz);
      }
      // スマホの帯：中の Issue の色の粒を、まとまりの周りに散らす
      if (this.mobile && b.count > 1) {
        const strip = this.strip[b.node.at];
        if (strip) {
          strip.whos.forEach((w, i) => {
            if (i >= 12) return;
            const an = t * 0.4 + i * 1.7;
            const rr = 9 + (i % 3) * 4;
            rctx.globalAlpha = 0.9;
            rctx.drawImage(sprites[w], x + Math.cos(an) * rr - 2.5, y + Math.sin(an) * rr * 0.7 - 2.5, 5, 5);
          });
        }
      }
    }
    if (gRect && mask) this.drawCurrent(dt, gRect, mask, reduced, decay);
    this.drawSparks(now, dt, bandTop);
    rctx.globalAlpha = 1;
    rctx.globalCompositeOperation = "source-over";
    if (this.fogDirty) this.drawFog();
    this.drawGiant(now, dt, reduced, gRect);
    if (this.sparks.length > 0 || this.hasTrails()) this.dirty = true;
  }

  /**
   * 数字の高さの帯を流れる川の粒：数字の左から入り、数字を通ると灯って、灯ったまま右へ抜けて冷める。
   * 流れが数字の中を通っていることを見せる（川と同じ式・同じ速さ）
   */
  private drawCurrent(dt: number, rect: DOMRect, mask: Uint8Array, reduced: boolean, decay: number) {
    const { rctx, sprites, t } = this;
    for (const p of this.gCurrent) {
      if (!reduced) {
        const q = { x: rect.left + p.x, y: rect.top + p.y, sp: p.sp, vx: 0, vy: 0 };
        this.flowStep(q, dt, t);
        p.x = q.x - rect.left;
        p.y = q.y - rect.top;
        p.heat *= decay;
        if (p.x > this.gW + CURRENT_OUT || p.y < -8 || p.y > this.gH + 8) {
          p.x = -CURRENT_IN * this.gRand();
          p.y = this.gRand() * this.gH;
          p.heat = 0;
        }
      }
      const lx = Math.floor(p.x);
      const ly = Math.floor(p.y);
      if (lx >= 0 && ly >= 0 && lx < this.gW && ly < this.gH && mask[ly * this.gW + lx] === 1) p.heat = 1;
      // 端では薄く（入り口と出口で急に現れない・消えない）
      const edge = Math.min(1, (p.x + CURRENT_IN) / 30, (this.gW + CURRENT_OUT - p.x) / 40);
      const tw = 0.55 + 0.45 * Math.sin(t * 1.1 + p.ph);
      if (p.heat > 0.02) {
        rctx.globalAlpha = Math.max(0, Math.min(1, (0.08 * tw + 0.7 * p.heat) * edge));
        const sz = 4 * p.s * (1 + 0.6 * p.heat);
        rctx.drawImage(sprites.amber, rect.left + p.x - sz / 2, rect.top + p.y - sz / 2, sz, sz);
      } else {
        rctx.globalAlpha = Math.max(0, 0.22 * tw * edge);
        const sz = 4 * p.s;
        rctx.drawImage(sprites.river, rect.left + p.x - sz / 2, rect.top + p.y - sz / 2, sz, sz);
      }
    }
  }

  private hasTrails(): boolean {
    for (const b of this.bodies.values()) if (b.trail.length > 0) return true;
    return false;
  }

  /** 飛んでいる光の尾（通った所に残る点。0.45秒で消える） */
  private drawTrail(trail: TrailDot[], who: FlowWho, dt: number, bandTop: number) {
    if (trail.length === 0) return;
    const fade = (0.7 / TRAIL_LIFE) * dt;
    for (let k = trail.length - 1; k >= 0; k--) {
      const d = trail[k];
      d.a -= fade;
      if (d.a <= 0) {
        trail.splice(k, 1);
        continue;
      }
      const [x, y] = this.toXY(d.u, d.v);
      this.rctx.globalAlpha = d.a * (y > bandTop ? 0.3 : 1);
      this.rctx.drawImage(this.sprites[who], x - 1.5, y - 1.5, 3, 3);
    }
  }

  /** スマホの帯：押した Issue の段階から、次の段階へ飛ぶ光（0.6秒） */
  private drawSparks(now: number, dt: number, bandTop: number) {
    for (let k = this.sparks.length - 1; k >= 0; k--) {
      const s = this.sparks[k];
      const p = Math.min(1, (now - s.t0) / 600);
      const e = ease(p);
      const u = s.u0 + (s.u1 - s.u0) * e;
      const v = s.v0 + (s.v1 - s.v0) * e - Math.sin(p * Math.PI) * 14;
      if (p < 1) s.trail.push({ u, v, a: 0.7 });
      this.drawTrail(s.trail, s.who, dt, bandTop);
      if (p < 1) {
        const [x, y] = this.toXY(u, v);
        this.rctx.globalAlpha = 0.6;
        this.rctx.drawImage(this.sprites[`${s.who}_glow`], x - 12, y - 12, 24, 24);
        this.rctx.globalAlpha = 1;
        this.rctx.drawImage(this.sprites[s.who], x - 3, y - 3, 6, 6);
      } else if (s.trail.length === 0) {
        this.sparks.splice(k, 1);
      }
    }
  }

  private moveLabel(b: Body) {
    const el = this.labels.get(b.node.key);
    if (!el) return;
    if (Math.abs(b.pu - b.lastX) <= 0.05 && Math.abs(b.pv - b.lastY) <= 0.05) return;
    el.style.setProperty("--x", `${b.pu}px`);
    el.style.setProperty("--y", `${b.pv}px`);
    b.lastX = b.pu;
    b.lastY = b.pv;
  }

  /**
   * 霧：低解像度で1回だけ描き、背景の画像にして引き伸ばす（動かさない）。
   * 画面いっぱいの canvas の層を重ねると、GPU の無い環境で毎フレームの重ね合わせが重いため
   */
  private drawFog() {
    this.fogDirty = false;
    const { fctx } = this;
    const w = this.fogCanvas.width;
    const h = this.fogCanvas.height;
    fctx.clearRect(0, 0, w, h);
    fctx.globalCompositeOperation = "lighter";
    const blobs: [number, number, FlowWho, number][] = [
      [0.14, 0.42, "human", 0.2],
      [0.55, 0.3, "ai", 0.18],
      [0.9, 0.4, "done", 0.13],
      [0.36, 0.7, "ai", 0.12],
      [0.72, 0.74, "queue", 0.1],
    ];
    for (const [bx, by, c, al] of blobs) {
      const x = bx * w;
      const y = by * h;
      const r = Math.max(w, h) * 0.36;
      const g = fctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${WHO_RGB[c]},${al * 0.9})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      fctx.fillStyle = g;
      fctx.fillRect(0, 0, w, h);
    }
    fctx.globalCompositeOperation = "source-over";
    const style = this.el.fog.style;
    style.setProperty("background-image", `url(${this.fogCanvas.toDataURL()})`);
    style.setProperty("background-size", "100% 100%");
    style.setProperty("background-attachment", "fixed");
    style.setProperty("background-repeat", "no-repeat");
  }

  /* ───── 巨大な数字：川の粒が、同じ向き・同じ速さで数字の中を通る ───── */

  private giantFont() {
    return `800 ${this.gFs}px ${this.giantFamily}`;
  }

  private giantLayout() {
    const g = this.giant;
    if (!g) return;
    const ctx = g.canvas.getContext("2d");
    if (!ctx) return;
    this.gFs = parseFloat(getComputedStyle(g.canvas.parentElement ?? g.canvas).fontSize);
    g.ghost.textContent = String(this.gValue);
    ctx.font = this.giantFont();
    const text = String(Math.max(this.gValue, this.gPrev ?? 0));
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent;
    const des = m.actualBoundingBoxDescent;
    this.gW = Math.ceil(m.width - this.gFs * 0.06 * (text.length - 1)) + 4;
    this.gH = Math.ceil(asc + des) + 8;
    this.gMetrics = { asc, left: m.actualBoundingBoxLeft };
    this.gDpr = Math.min(devicePixelRatio || 1, 2);
    const box = g.canvas.parentElement;
    if (box) {
      box.style.width = `${this.gW}px`;
      box.style.height = `${this.gH}px`;
    }
    for (const c of [g.canvas, this.gField, this.gTmp, this.gBase]) {
      c.width = Math.round(this.gW * this.gDpr);
      c.height = Math.round(this.gH * this.gDpr);
      c.style.width = `${this.gW}px`;
      c.style.height = `${this.gH}px`;
    }
    this.drawGiantBase();
    this.buildMask();
    const n = Math.round((this.gW * this.gH) / 260);
    this.gRand = seededRandom(11);
    const r = this.gRand;
    this.gLocal = [];
    for (let k = 0; k < n; k++) {
      this.gLocal.push({ x: r() * this.gW, y: r() * this.gH, s: 0.6 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 0.8, heat: 0, vx: 0, vy: 0 });
    }
    const span = this.gW + CURRENT_IN + CURRENT_OUT;
    this.gCurrent = [];
    for (let k = 0; k < Math.round((span * this.gH) / 900); k++) {
      const x = r() * span - CURRENT_IN;
      // 最初から、数字を出た粒は灯った名残りがある状態にする（開いた瞬間から流れが見える）
      const heat = x > this.gW * 0.5 ? Math.exp((-HEAT_DECAY * (x - this.gW * 0.5)) / RIVER_SPEED) : 0;
      this.gCurrent.push({ x, y: r() * this.gH, s: 0.6 + r() * 1.1, ph: r() * 6.28, sp: 0.6 + r() * 0.8, heat, vx: 0, vy: 0 });
    }
  }

  /** 数字の中の地と、止まった2つの光（数字を描き直すときだけ） */
  private drawGiantBase() {
    const fc = this.gBase.getContext("2d");
    if (!fc) return;
    const { gW: GW, gH: GH, gDpr: dpr } = this;
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fc.globalCompositeOperation = "source-over";
    fc.fillStyle = "#2A1804";
    fc.fillRect(0, 0, GW, GH);
    fc.globalCompositeOperation = "lighter";
    const blobs: [string, number, number, number][] = [
      ["255,176,64", 0.9, 0.3, 0.25],
      ["255,118,34", 0.7, 0.75, 0.8],
    ];
    for (const [c, a, bx, by] of blobs) {
      const x = GW * bx;
      const y = GH * by;
      const r = Math.max(GW, GH) * 0.6;
      const grd = fc.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${c},${a})`);
      grd.addColorStop(1, `rgba(${c},0)`);
      fc.fillStyle = grd;
      fc.fillRect(0, 0, GW, GH);
    }
    fc.globalCompositeOperation = "source-over";
  }

  /** 数字の形の型（1倍）：川の粒が数字の中にいるかを見る */
  private buildMask() {
    const w = this.gW;
    const h = this.gH;
    if (!this.gMetrics || w <= 0 || h <= 0) {
      this.gMask = null;
      return;
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (!x) return;
    x.font = this.giantFont();
    x.textBaseline = "alphabetic";
    x.letterSpacing = `${-0.06 * this.gFs}px`;
    x.fillStyle = "#fff";
    x.fillText(String(this.gValue), this.gMetrics.left + 2, this.gMetrics.asc + 4);
    const data = x.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    this.gMask = mask;
  }

  private drawGiantField(dt: number, rect: DOMRect, reduced: boolean) {
    const fc = this.gField.getContext("2d");
    if (!fc) return;
    const { gW: GW, gH: GH, gDpr: dpr, t } = this;
    const tt = reduced ? 12 : t;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = "source-over";
    fc.drawImage(this.gBase, 0, 0);
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fc.globalCompositeOperation = "lighter";
    for (const p of this.gLocal) {
      if (!reduced) {
        const q = { x: rect.left + p.x, y: rect.top + p.y, sp: p.sp, vx: 0, vy: 0 };
        this.flowStep(q, dt, t);
        p.x = q.x - rect.left;
        p.y = q.y - rect.top;
        p.vx = q.vx;
        p.vy = q.vy;
        if (p.x > GW + 4) {
          p.x = -4;
          p.y = this.gRand() * GH;
        }
        if (p.y < -4) p.y = GH + 4;
        if (p.y > GH + 4) p.y = -4;
      }
      const tw = 0.55 + 0.45 * Math.sin(tt * 1.1 + p.ph);
      const sz = 5 * p.s;
      // 進む向きの後ろに尾（速さ×0.3秒の長さに、薄くなる点を3つ）
      for (let i = 3; i >= 1; i--) {
        const back = (0.3 * i) / 3;
        fc.globalAlpha = 0.6 * tw * (1 - i / 4) * 0.7;
        const s2 = sz * (1 - i * 0.15);
        fc.drawImage(this.sprites.amber, p.x - p.vx * back - s2 / 2, p.y - p.vy * back - s2 / 2, s2, s2);
      }
      fc.globalAlpha = 0.6 * tw;
      fc.drawImage(this.sprites.amber, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    for (const p of this.river) {
      const x = p.x - rect.left;
      const y = p.y - rect.top;
      if (x < -4 || y < -4 || x > GW + 4 || y > GH + 4) continue;
      fc.globalAlpha = 0.8;
      const sz = 9 * p.s;
      fc.drawImage(this.sprites.amber, x - sz / 2, y - sz / 2, sz, sz);
    }
    fc.globalAlpha = 1;
    fc.globalCompositeOperation = "source-over";
  }

  private glyph(ctx: CanvasRenderingContext2D, text: string, dy: number, alpha: number) {
    const tc = this.gTmp.getContext("2d");
    if (!tc || !this.gMetrics) return;
    const { gDpr: dpr, gFs: fs } = this;
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.globalCompositeOperation = "source-over";
    tc.clearRect(0, 0, this.gTmp.width, this.gTmp.height);
    tc.save();
    tc.scale(dpr, dpr);
    tc.font = this.giantFont();
    tc.textBaseline = "alphabetic";
    tc.letterSpacing = `${-0.06 * fs}px`;
    tc.fillStyle = "#fff";
    tc.fillText(text, this.gMetrics.left + 2, this.gMetrics.asc + 4 + dy);
    tc.restore();
    tc.globalCompositeOperation = "source-in";
    tc.drawImage(this.gField, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.gTmp, 0, 0);
    ctx.globalAlpha = 1;
  }

  private drawGiant(now: number, dt: number, reduced: boolean, rect: DOMRect | null) {
    const g = this.giant;
    if (!g || !rect) return;
    const ctx = g.canvas.getContext("2d");
    if (!ctx) return;
    if (this.gRoll < 1) this.gRoll = Math.min(1, (now - this.gRollT0) / 460);
    this.drawGiantField(dt, rect, reduced);
    ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
    if (this.gRoll < 1 && this.gPrev !== null) {
      const p = ease(this.gRoll);
      this.glyph(ctx, String(this.gPrev), -this.gH * 0.9 * p, 1 - p);
      this.glyph(ctx, String(this.gValue), this.gH * 0.9 * (1 - p), p);
    } else {
      this.glyph(ctx, String(this.gValue), 0, 1);
    }
  }
}
