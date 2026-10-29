import { layoutFlow, stripColumns, type LabelVariant, type MeasureLabel } from "@/lib/flow/layout";
import type { FlowNode, FlowWho } from "@/lib/flow/nodes";
import { seededRandom, seedOf } from "@/lib/flow/random";

/**
 * 流れの映像（docs/design.md の「流れ」「動き」）。
 * 画面全体の canvas に、川（背景の粒）・Issue の光と粒・霧を描き、名札（HTML）を光に追従させる。
 * 巨大な数字の中の粒も、同じ川の式で動かす（生きている映像は1系統だけ）。
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
/** 公開済みが右端へ抜ける粒の速さ */
const CLUSTER_KEY = "cluster:deployed";

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
  flip: boolean;
  width: number;
  variant: LabelVariant;
  fresh: boolean;
  lastX: number;
  lastY: number;
  rand: () => number;
  /** 公開済みのまとまり（件数ぶんの小さな芯） */
  count: number;
};

type RiverParticle = { x: number; y: number; s: number; ph: number; sp: number };

export type EngineElements = {
  river: HTMLCanvasElement;
  fog: HTMLCanvasElement;
  /** 流れの場所（PC：段階の列の面、スマホ：細い帯）。無ければ川だけ描く */
  flow: HTMLElement | null;
  /** 名札の容れ物（PC） */
  nodes: HTMLElement | null;
  /** すりガラスの帯（この上端より下は粒を暗くする） */
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
  private sprites: Record<string, HTMLCanvasElement> = {};
  private W = 0;
  private H = 0;
  private DPR = 1;
  private t = 0;
  private last = 0;
  private raf = 0;
  private fogT = 0;
  private dirty = true;
  private mobile = false;
  private flowRect = { left: 0, top: 0, width: 0, height: 0 };
  private columnWidth = 0;
  private scale = 1;
  private labelFs = 12;
  private labelFamily = "sans-serif";
  private giantFamily = "sans-serif";
  private bandTop = Infinity;
  private riverRand = seededRandom(7);
  private meas: CanvasRenderingContext2D | null = null;
  private strip: { x: number; count: number; whos: FlowWho[]; lead: FlowWho | null; keys: string[] }[] = [];
  private stripHl = -1;
  /** 巨大な数字 */
  private giant: GiantElements | null = null;
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
  private gLocal: RiverParticle[] = [];
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
    this.fctx = elements.fog.getContext("2d") as CanvasRenderingContext2D;
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
    removeEventListener("resize", this.onResize);
    removeEventListener("scroll", this.onScroll);
  }

  /** 名札の要素を登録する（React が描いた物） */
  setLabel(key: string, element: HTMLElement | null) {
    if (element) this.labels.set(key, element);
    else this.labels.delete(key);
    this.dirty = true;
  }

  /** 流れに出す Issue を入れ替える。animate なら、段階が変わった光が前の位置から流れて移る */
  setNodes(nodes: FlowNode[], animate: boolean) {
    this.nodes = nodes;
    const keys = new Set(nodes.map((n) => n.key));
    keys.add(CLUSTER_KEY);
    for (const key of this.bodies.keys()) if (!keys.has(key)) this.bodies.delete(key);
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

  /** ボタンを押したあと：光が次の段階へ跳ねて、粒が噴く */
  kick(key: string) {
    const b = this.bodies.get(key);
    if (!b) return;
    b.vu += this.mobile ? 60 : 160;
    for (let k = 0; k < 12; k++) b.parts.push(this.mkPart(b, "comet", true));
    this.dirty = true;
  }

  /** 巨大な数字の canvas を登録する */
  setGiant(elements: GiantElements | null) {
    this.giant = elements;
    this.gReady = false;
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
    const { river, fog } = this.el;
    river.width = Math.round(this.W * this.DPR);
    river.height = Math.round(this.H * this.DPR);
    this.rctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    fog.width = Math.ceil(this.W / 4);
    fog.height = Math.ceil(this.H / 4);
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
      this.river.push({ x: r() * this.W, y: r() * this.H, s: 0.5 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 0.8 });
    }
  }

  private measure: MeasureLabel = (node, variant) => {
    const m = this.meas;
    if (!m) return { line1: 0, line2: 0 };
    const fs = this.labelFs;
    m.font = `500 ${fs}px ${this.labelFamily}`;
    const line1 = m.measureText((node.key === CLUSTER_KEY ? "" : `#${node.number} `) + node.label).width;
    if (variant === "compact") return { line1, line2: 0 };
    m.font = `400 ${fs * 0.96}px ${this.labelFamily}`;
    const line2 = m.measureText((variant === "full" ? `${node.repo} ` : "") + node.title).width;
    return { line1, line2 };
  };

  /** 光の位置を決める（PC：レーンに詰める、スマホ：段階ごとに1つ） */
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
    const gutter = parseFloat(getComputedStyle(flow).paddingLeft) || 0;
    const width = r.width - gutter * 2;
    const top = 30;
    const height = Math.max(60, r.height - 48);
    this.labelFs = this.opt.labelFontSize();
    if (this.el.nodes) this.labelFamily = getComputedStyle(this.el.nodes).fontFamily || "sans-serif";
    const layout = layoutFlow({ nodes: this.nodes, width, height, fontSize: this.labelFs, measure: this.measure });
    this.columnWidth = layout.columnWidth;
    this.scale = Math.min(1.5, Math.max(0.9, this.columnWidth / 190));
    const shown = new Set<string>();
    for (const p of layout.placed) {
      const node = p.key === CLUSTER_KEY ? this.clusterNode(layout.cluster?.count ?? 0) : this.nodes.find((n) => n.key === p.key);
      if (!node) continue;
      const b = this.place(node, gutter + p.x, top + p.y, animate);
      b.flip = p.flip;
      b.width = p.width;
      b.variant = p.variant;
      b.count = p.key === CLUSTER_KEY ? (layout.cluster?.count ?? 0) : 1;
      shown.add(p.key);
    }
    for (const [key, b] of this.bodies) {
      b.on = shown.has(key);
      const el = this.labels.get(key);
      if (!el) continue;
      el.toggleAttribute("data-off", !b.on);
      el.toggleAttribute("data-flip", b.flip);
      el.setAttribute("data-variant", b.variant);
      el.style.setProperty("--w", `${b.width}px`);
    }
    this.hideOrphanLabels(shown);
  }

  private hideOrphanLabels(shown: Set<string>) {
    for (const [key, el] of this.labels) if (!shown.has(key)) el.setAttribute("data-off", "");
  }

  private clusterNode(count: number): FlowNode {
    const dones = this.nodes.filter((n) => n.who === "done");
    const first = dones[0];
    return {
      key: CLUSTER_KEY,
      owner: first?.owner ?? "",
      repo: first?.repo ?? "",
      number: 0,
      title: "",
      url: first?.url ?? "",
      at: 7,
      who: "done",
      label: `公開済み ${count}件`,
      caption: "",
      deployLinks: [],
      logUrl: null,
      turn: false,
    };
  }

  /** スマホ：段階ごとに1つの光。列の中心は帯の中の x */
  private layoutStrip(animate: boolean) {
    const centers = this.opt.stripCenters();
    const columns = stripColumns(this.nodes);
    const v = Math.max(18, this.flowRect.height * 0.34);
    this.strip = [];
    const shown = new Set<string>();
    columns.forEach((column, k) => {
      const x = centers?.[k] ?? ((k + 0.5) * this.flowRect.width) / 8;
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
      shown.add(key);
    });
    for (const [key, b] of this.bodies) b.on = shown.has(key);
    this.hideOrphanLabels(new Set());
    this.scale = 1;
  }

  private place(node: FlowNode, u: number, v: number, animate: boolean): Body {
    let b = this.bodies.get(node.key);
    if (!b) {
      b = this.makeBody(node);
      this.bodies.set(node.key, b);
    }
    const moved = b.node.at !== node.at;
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
      flip: false,
      width: 120,
      variant: "full",
      fresh: true,
      lastX: NaN,
      lastY: NaN,
      rand: seededRandom(seedOf(node.key)),
      count: 1,
    };
    this.seedParts(b);
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

  private seedParts(b: Body) {
    const who = b.node.who;
    const n = b.count > 1 ? 2.2 : 1;
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
                  ["orbit", Math.round(8 * n)],
                  ["exit", Math.round(12 * n)],
                ];
    b.parts = [];
    for (const [type, count] of mix) for (let m = 0; m < count; m++) b.parts.push(this.mkPart(b, type, false));
    b.seededFor = `${who}:${b.count > 1 ? b.count : ""}`;
  }

  /** 川の粒を1歩進める（画面の座標）。数字の中の粒も同じ式を使う */
  private flowStep(p: { x: number; y: number; sp: number }, dt: number, t: number) {
    const c = curl(p.x, p.y, t);
    p.x += (RIVER_SPEED * p.sp + c[0] * RIVER_AMP * 12) * dt;
    p.y += c[1] * RIVER_AMP * 12 * dt;
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

  private draw(now: number, dt: number, reduced: boolean) {
    const { rctx, W, H, t, sprites } = this;
    const band = this.el.band;
    this.bandTop = band ? band.getBoundingClientRect().top + 30 : Infinity;
    const bandTop = this.bandTop;
    rctx.clearRect(0, 0, W, H);
    rctx.globalCompositeOperation = "lighter";
    // 川
    for (const p of this.river) {
      if (!reduced) {
        this.flowStep(p, dt, t);
        if (p.x > W + 6) {
          p.x = -6;
          p.y = this.riverRand() * H;
        }
        if (p.y < -6) p.y = H + 6;
        if (p.y > H + 6) p.y = -6;
      }
      const tw = 0.55 + 0.45 * Math.sin(t * 1.1 + p.ph);
      let a = 0.15 * tw;
      if (p.y > bandTop) a *= 0.3;
      rctx.globalAlpha = a;
      const sz = 4 * p.s;
      rctx.drawImage(sprites.river, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    // 光と粒
    const sc = this.mobile ? 1 : this.scale;
    for (const b of this.bodies.values()) {
      if (!b.on) continue;
      const who = b.node.who;
      const seedKey = `${who}:${b.count > 1 ? b.count : ""}`;
      if (b.seededFor !== seedKey) this.seedParts(b);
      if (!reduced) {
        b.vu += (SPRING_K * (b.u - b.pu) - SPRING_C * b.vu) * dt;
        b.vv += (SPRING_K * (b.v - b.pv) - SPRING_C * b.vv) * dt;
        b.pu += b.vu * dt;
        b.pv += b.vv * dt;
      } else {
        b.pu = b.u;
        b.pv = b.v;
      }
      const stripHl = this.mobile && this.stripHl === b.node.at ? 1 : 0;
      b.hl += (Math.max(b.hlT, stripHl) - b.hl) * Math.min(1, dt * 10);
      const [x, y] = this.toXY(b.pu, b.pv);
      if (!this.mobile) this.moveLabel(b);
      const dim = y > bandTop ? 0.3 : 1;
      const big = b.count > 1 ? 1.3 : 1;
      let g = who === "human" ? 0.5 : who === "ai" ? 0.3 : who === "queue" ? 0.18 : who === "fail" ? 0.3 : 0.22;
      g = (g + b.hl * 0.35) * dim;
      let gr = (who === "human" ? 24 : who === "queue" ? 24 : 18) * sc * big;
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
          const du = Math.cos(p.a) * rr + jx;
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
          const edge = W - x;
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
    rctx.globalAlpha = 1;
    rctx.globalCompositeOperation = "source-over";
    this.drawFog();
    this.drawGiant(now, dt, reduced);
  }

  private moveLabel(b: Body) {
    const el = this.labels.get(b.node.key);
    if (!el) return;
    const lx = b.flip ? b.pu - 19 - b.width : b.pu + 18;
    const ly = b.pv - this.labelFs * 0.65 - 3;
    if (Math.abs(lx - b.lastX) <= 0.05 && Math.abs(ly - b.lastY) <= 0.05) return;
    el.style.setProperty("--x", `${lx}px`);
    el.style.setProperty("--y", `${ly}px`);
    b.lastX = lx;
    b.lastY = ly;
  }

  /** 霧：低解像度で描いて引き伸ばす（すりガラスがこれをぼかす） */
  private drawFog() {
    this.fogT++;
    if (this.fogT % 3 !== 1 && this.fogT > 2) return;
    const { fctx, t } = this;
    const w = this.el.fog.width;
    const h = this.el.fog.height;
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
      const x = (bx + 0.04 * Math.sin(t * 0.09 + bx * 9)) * w;
      const y = (by + 0.05 * Math.cos(t * 0.07 + by * 7)) * h;
      const r = Math.max(w, h) * 0.36;
      const g = fctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${WHO_RGB[c]},${al})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      fctx.fillStyle = g;
      fctx.fillRect(0, 0, w, h);
    }
    fctx.globalCompositeOperation = "source-over";
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
    for (const c of [g.canvas, this.gField, this.gTmp]) {
      c.width = Math.round(this.gW * this.gDpr);
      c.height = Math.round(this.gH * this.gDpr);
      c.style.width = `${this.gW}px`;
      c.style.height = `${this.gH}px`;
    }
    const n = Math.round((this.gW * this.gH) / 300);
    this.gRand = seededRandom(11);
    const r = this.gRand;
    this.gLocal = [];
    for (let k = 0; k < n; k++) {
      this.gLocal.push({ x: r() * this.gW, y: r() * this.gH, s: 0.6 + r() * 1.2, ph: r() * 6.28, sp: 0.6 + r() * 0.8 });
    }
  }

  private drawGiantField(dt: number, rect: DOMRect, reduced: boolean) {
    const fc = this.gField.getContext("2d");
    if (!fc) return;
    const { gW: GW, gH: GH, gDpr: dpr, t } = this;
    const tt = reduced ? 12 : t;
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fc.globalCompositeOperation = "source-over";
    fc.fillStyle = "#2A1804";
    fc.fillRect(0, 0, GW, GH);
    fc.globalCompositeOperation = "lighter";
    const blobs: [string, number, number, number][] = [
      ["255,176,64", 0.9, 0.21, 0],
      ["255,118,34", 0.7, 0.16, 2.1],
    ];
    blobs.forEach(([c, a, sp, ph], i) => {
      const x = GW * (0.5 + 0.5 * Math.sin(tt * sp + ph));
      const y = GH * (0.5 + 0.55 * Math.cos(tt * sp * 0.8 + ph * 1.7));
      const r = Math.max(GW, GH) * (0.6 + 0.1 * Math.sin(tt * 0.3 + i));
      const g = fc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      fc.fillStyle = g;
      fc.fillRect(0, 0, GW, GH);
    });
    for (const p of this.gLocal) {
      if (!reduced) {
        const q = { x: rect.left + p.x, y: rect.top + p.y, sp: p.sp };
        this.flowStep(q, dt, t);
        p.x = q.x - rect.left;
        p.y = q.y - rect.top;
        if (p.x > GW + 4) {
          p.x = -4;
          p.y = this.gRand() * GH;
        }
        if (p.y < -4) p.y = GH + 4;
        if (p.y > GH + 4) p.y = -4;
      }
      const tw = 0.55 + 0.45 * Math.sin(tt * 1.1 + p.ph);
      fc.globalAlpha = 0.55 * tw;
      const sz = 7 * p.s;
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

  private drawGiant(now: number, dt: number, reduced: boolean) {
    const g = this.giant;
    if (!g || !this.gReady || !this.gMetrics) return;
    const ctx = g.canvas.getContext("2d");
    if (!ctx) return;
    if (this.gRoll < 1) this.gRoll = Math.min(1, (now - this.gRollT0) / 460);
    const rect = g.canvas.getBoundingClientRect();
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
