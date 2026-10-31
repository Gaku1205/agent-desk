import {
  DOT_OFFSET,
  FOOT_ROOM,
  layoutFlow,
  stripColumns,
  type LabelMetrics,
  type LabelVariant,
  type MeasureLabel,
  type PrevSeats,
  type TitleBox,
} from "@/lib/flow/layout";
import type { FlowNode, FlowWho } from "@/lib/flow/nodes";
import { seededRandom, seedOf } from "@/lib/flow/random";
import { stripLight, type StripLight } from "@/lib/flow/stripLight";
import { GIANT_UNIT_GAP, inkRightOf, unitLeft, unitShift } from "@/lib/giantUnit";
import { squeezeTowardLabel } from "@/lib/flow/squeeze";

/**
 * 流れの映像（docs/design.md の「映像」「流れ（PC）」「動き」）。
 * 画面全体の canvas に、川（背景の粒）・光の筋（レーン）・Issue の光と粒・止まった霧を描き、名札（HTML）を光に追従させる。
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

/** 公開済みの塊の名札・光のキー */
export const CLUSTER_KEY = "__done";

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
/** 灯りの区域（数字の上・下、端で薄くする幅） */
const LIT_ABOVE = 40;
const LIT_BELOW = 16;
const LIT_FADE = 30;
/** 飛んでいる光が、段階が変わらないまま戻るまで */
const FLY_MS = 8000;
/** 飛んでいる光が尾を残す速さ（px/秒）と、尾の長さ（秒） */
const TRAIL_SPEED = 60;
const TRAIL_LIFE = 0.45;
const TRAIL_MAX = 40;
/** 光の筋：両端で消す幅、きらめきの長さ・速さ・1本の数 */
const THREAD_FADE = 90;
const GLINT_LEN = 90;
const GLINT_SPEED = 72;
const GLINTS_PER_LANE = 2;
/** 光の尾の長さ（光から左へ）。0 は尾を引かない */
const TAIL_LEN: Record<FlowWho, number> = { human: 60, ai: 46, fail: 28, queue: 0, done: 0 };
/** この距離より目標から離れている光は「動いている」（名札を隠す） */
const MOVING_PX = 2;
/** 数字の canvas を、箱の上下にはみ出させる割合（転がる数字を端で消す所） */
const GIANT_PAD = 0.35;

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
  /** 題名の札（常に出す名札だけ。乗せたときに出す）の幅と、光からの位置 */
  tip: TitleBox | null;
  /** 公開済みの粒が抜けて消える所（列の右端。流れの中の座標。スマホの帯） */
  edgeU: number;
  fresh: boolean;
  lastX: number;
  lastY: number;
  rand: () => number;
  /** スマホの帯のまとまり・公開済みの塊（件数ぶん） */
  count: number;
  /** スマホの帯の光（色・芯・粒の数。PC は null） */
  light: StripLight | null;
  /** 押したときに飛んで行く先（null なら配置どおり） */
  flyU: number | null;
  flyUntil: number;
  trail: TrailDot[];
  /** 名札を隠している（動いている） */
  moving: boolean;
  /** 光の尾を伸ばしてよい長さ（同じレーンの左の名札の手前まで） */
  tailRoom: number;
};

type RiverParticle = { x: number; y: number; s: number; ph: number; sp: number; heat: number; vx: number; vy: number };

/** スマホの帯で、押した Issue の段階から次の段階へ飛ぶ光 */
type Spark = { u0: number; v0: number; u1: number; v1: number; t0: number; who: FlowWho; trail: TrailDot[] };

/** 光の筋の上を走るきらめき（u は頭の位置。流れの中の座標） */
type Glint = { lane: number; u: number; sp: number };

/** 灯りの区域（画面の座標） */
type Zone = { x0: number; x1: number; y0: number; y1: number };

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

export type GiantElements = {
  canvas: HTMLCanvasElement;
  ghost: HTMLElement;
  /** 「件」。数字の字面の右端から6pxに置く（位置は giantLayout が決める） */
  unit: HTMLElement | null;
  /** 灯った粒を見せてよい右端（画面の x）。押す列の文字・ボタンの手前 */
  litEdge: () => number;
};

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

/** 横に細長い光（左は透明、右が明るい）。光の尾ときらめき。縦はやわらかく消える */
function makeStreak(rgb: string, w: number, h: number, head: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  // 先頭（右）の数pxで消す（頭を四角く切らない）
  const across = g.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, `rgba(${rgb},0)`);
  across.addColorStop(0.7, `rgba(${rgb},${0.4 * head})`);
  across.addColorStop(0.92, `rgba(${rgb},${head})`);
  across.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = across;
  g.fillRect(0, 0, w, h);
  // 縦：真ん中だけ残す
  g.globalCompositeOperation = "destination-in";
  const down = g.createLinearGradient(0, 0, 0, h);
  down.addColorStop(0, "rgba(0,0,0,0)");
  down.addColorStop(0.5, "rgba(0,0,0,1)");
  down.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = down;
  g.fillRect(0, 0, w, h);
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
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

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
  /** rAF を回している */
  private running = false;
  /** 流れが画面の中にある（無い流れのページでは常に true） */
  private flowVisible = true;
  private observer: IntersectionObserver | null = null;
  private sizeObserver: ResizeObserver | null = null;
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
  /** 前の配置の席（押した物以外を動かさないため） */
  private seats: PrevSeats | null = null;
  /** レーンの縦の位置（光の区域の中の座標）と、光の筋の画像 */
  private laneYs: number[] = [];
  /** 筋の縦の位置の基準（流れの上端から。PC は段階の目盛りの下、スマホは 0） */
  private laneTop = STAGES_H;
  /** スマホの帯の光の高さ */
  private stripV = 0;
  private threads: HTMLCanvasElement = document.createElement("canvas");
  private threadsKey = "";
  private glints: Glint[] = [];
  /** 常に出す名札の所（光の筋を切る所。流れの中の x とレーン） */
  private gaps: { lane: number; x0: number; x1: number }[] = [];
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
  /** 寸法を測る canvas。描く canvas（gTmp・gBase）と同じ DOM の外に置く（画面の canvas は tabular-nums を受け継ぎ、字形が変わるため） */
  private gMeasure: HTMLCanvasElement = document.createElement("canvas");
  /** 「件」の左端（箱の左端から）。前に置いた位置（転がり中に跳ばないための出発点） */
  private gUnitX: number | null = null;
  private gH = 0;
  /** 数字の canvas の、箱の上下へのはみ出し */
  private gPad = 0;
  /** 今フレームで描く縦の範囲（canvas の画素）。転がっていなければ箱の中だけ（描く面積を増やさない） */
  private gSpan: [number, number] = [0, 0];
  private gDpr = 1;
  private gFs = 0;
  private gReady = false;
  private gMetrics: { asc: number; left: number } | null = null;
  /** 数字の形の型（1倍。箱の中だけ。1 = 数字の中） */
  private gMask: Uint8Array | null = null;
  private gLocal: RiverParticle[] = [];
  /** 数字の高さの帯を、数字の左から入って右へ抜ける川の粒（数字に対する位置） */
  private gCurrent: RiverParticle[] = [];
  private gRand = seededRandom(11);
  private onScroll = () => {
    this.dirty = true;
    // 流れが画面の外で止まっていても、スクロールのたびに1回だけ描き直す
    // （止めた瞬間の1枚が残り、灯った粒が本文の上に居座らないように）
    if (!this.flowVisible) this.wake();
  };
  private onResize = () => {
    this.resize();
  };
  private onVisibility = () => {
    if (!document.hidden) this.wake();
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
    document.addEventListener("visibilitychange", this.onVisibility);
    // 流れが画面の外（上端の帯の下に見えていない）なら描かない
    if (elements.flow && typeof IntersectionObserver === "function") {
      this.observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          this.flowVisible = entry.isIntersecting;
          this.dirty = true;
          if (this.flowVisible) this.wake();
        },
        { rootMargin: "-52px 0px 0px 0px" },
      );
      this.observer.observe(elements.flow);
    }
    // 帯の幅は、窓の幅が同じでも変わる（縦スクロールバーが出る・消える）。変わったら測り直して置き直す
    if (elements.flow && typeof ResizeObserver === "function") {
      this.sizeObserver = new ResizeObserver(() => {
        const flow = this.el.flow;
        if (!flow) return;
        const width = flow.getBoundingClientRect().width;
        if (Math.abs(width - this.flowRect.width) < 0.5) return;
        this.layout(false);
        this.dirty = true;
        this.wake();
      });
      this.sizeObserver.observe(elements.flow);
    }
    this.wake();
    if (typeof document.fonts?.ready?.then === "function") {
      void document.fonts.ready.then(() => {
        this.layout(false);
        this.dirty = true;
        this.wake();
      });
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.observer?.disconnect();
    this.sizeObserver?.disconnect();
    for (const prop of ["background-image", "background-size", "background-attachment", "background-repeat"]) {
      this.el.fog.style.removeProperty(prop);
    }
    removeEventListener("resize", this.onResize);
    removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** 描く物があれば rAF を回し始める */
  private wake() {
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 名札の要素を登録する（React が描いた物） */
  setLabel(key: string, element: HTMLElement | null) {
    if (element) this.labels.set(key, element);
    else this.labels.delete(key);
    const b = this.bodies.get(key);
    if (b && element) {
      b.lastX = NaN;
      this.applyLabel(b, element);
    } else if (element && !b) {
      element.setAttribute("data-off", "");
    }
    this.dirty = true;
  }

  /** 流れに出す Issue を入れ替える。animate なら、段階が変わった光が前の位置から流れて移る */
  setNodes(nodes: FlowNode[], animate: boolean) {
    this.nodes = nodes;
    this.multiRepo = new Set(nodes.map((n) => `${n.owner}/${n.repo}`)).size > 1;
    const keys = new Set(nodes.map((n) => n.key));
    for (const key of this.bodies.keys()) {
      if (!key.startsWith("strip:") && key !== CLUSTER_KEY && !keys.has(key)) this.bodies.delete(key);
    }
    this.layout(animate);
    this.dirty = true;
    this.wake();
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
   * ボタンを押した：その光が、操作のあとの段階の列（column）まで、自分の筋の上を飛んで行く。
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
      this.wake();
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
      this.gPrev = null;
    } else {
      this.gRoll = 0;
      this.gRollT0 = performance.now();
    }
    this.giantLayout();
    this.dirty = true;
    this.wake();
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
      this.sprites[`${who}_tail`] = makeStreak(WHO_RGB[who], 64, 6, 1);
    }
    this.sprites.river = makeSprite("150,165,205", 12, false);
    this.sprites.amber = makeSprite("255,196,96", 12, false);
    this.sprites.mute = makeSprite("140,137,129", 16, false);
    this.sprites.glint = makeStreak("210,220,245", 96, 8, 1);
    this.seedRiver();
    this.layout(false);
    if (this.gReady) this.giantLayout();
    this.dirty = true;
    this.wake();
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

  private measureText(id: string, status: string, title: string): LabelMetrics {
    const m = this.meas;
    if (!m) return { id: 0, status: 0, title: 0 };
    const fs = this.labelFs;
    m.font = `400 ${fs * 0.92}px ${this.labelFamily}`;
    const idW = m.measureText(id).width;
    m.font = `500 ${fs}px ${this.labelFamily}`;
    const statusW = m.measureText(status).width;
    m.font = `400 ${fs * 0.96}px ${this.labelFamily}`;
    const titleW = m.measureText(title).width;
    return { id: idW, status: statusW, title: titleW };
  }

  private measure: MeasureLabel = (node) => this.measureText(this.idText(node), node.label, node.title);

  /** 光の位置を決める（PC：レーンの上・段階の列の中、スマホ：段階ごとに1つ） */
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
    this.laneTop = STAGES_H;
    for (const key of [...this.bodies.keys()]) if (key.startsWith("strip:")) this.bodies.delete(key);
    const gutter = parseFloat(getComputedStyle(flow).paddingLeft) || 0;
    this.gutter = gutter;
    const width = r.width - gutter * 2;
    const height = Math.max(40, r.height - STAGES_H - FOOT_ROOM);
    this.labelFs = this.opt.labelFontSize();
    if (this.el.nodes) this.labelFamily = getComputedStyle(this.el.nodes).fontFamily || "sans-serif";
    const done = this.nodes.filter((n) => n.who === "done");
    const layout = layoutFlow({
      nodes: this.nodes,
      width,
      height,
      fontSize: this.labelFs,
      overhang: gutter,
      measure: this.measure,
      prev: this.seats,
      clusterMetrics: done[0] ? this.measureText(`${done.length}件`, "公開済み", `${done[0].title} ほか`) : undefined,
    });
    this.seats = layout.next;
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
      b.tip = p.tip;
      b.count = 1;
      shown.add(p.key);
    }
    const c = layout.cluster;
    if (c) {
      const node: FlowNode = {
        key: CLUSTER_KEY,
        owner: "",
        repo: "",
        number: 0,
        title: "",
        url: "",
        at: 7,
        who: "done",
        label: "",
        caption: "",
        rowText: null,
        deployLinks: [],
        logUrl: null,
        turn: false,
        urgent: false,
      };
      const b = this.place(node, gutter + c.x, STAGES_H + c.y, animate);
      b.pinned = false;
      b.width = c.width;
      b.variant = c.variant;
      b.dx = c.dx;
      b.dy = c.dy;
      b.tip = null;
      b.count = c.keys.length;
      shown.add(CLUSTER_KEY);
    } else {
      this.bodies.delete(CLUSTER_KEY);
    }
    for (const [key, b] of this.bodies) {
      b.on = shown.has(key);
      const el = this.labels.get(key);
      if (el) this.applyLabel(b, el);
    }
    for (const [key, el] of this.labels) if (!shown.has(key)) el.setAttribute("data-off", "");
    this.laneYs = layout.laneYs;
    // 光の筋は、常に出す名札の文字の所で切る（線を文字に通さない）。光の尾も左の名札の手前まで
    this.gaps = layout.placed
      .filter((p) => p.pinned)
      .map((p) => ({ lane: p.lane, x0: gutter + p.x + p.dx - 4, x1: gutter + p.x + p.dx + p.width + 4 }));
    for (const p of layout.placed) {
      const b = this.bodies.get(p.key);
      if (!b) continue;
      const u = gutter + p.x;
      const left = this.gaps.filter((g) => g.lane === p.lane && g.x1 <= u).reduce((m, g) => Math.max(m, g.x1), -Infinity);
      b.tailRoom = Math.max(0, u - left - 6);
    }
    this.buildThreads(r.width, height, THREAD_FADE);
  }

  /** 光の筋（レーンごとに1本）を1回だけ描いて画像にする。きらめきの位置も決める。fade は両端を消す幅 */
  private buildThreads(width: number, height: number, fadeLen: number) {
    const key = `${width}x${height}:${fadeLen}:${this.laneYs.join(",")}:${this.DPR}:${this.gaps.map((g) => `${g.lane}/${Math.round(g.x0)}/${Math.round(g.x1)}`).join(",")}`;
    if (key === this.threadsKey) return;
    this.threadsKey = key;
    const pad = 4;
    const c = this.threads;
    c.width = Math.max(1, Math.round(width * this.DPR));
    c.height = Math.max(1, Math.round((height + pad * 2) * this.DPR));
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    g.clearRect(0, 0, width, height + pad * 2);
    const step = 3;
    this.laneYs.forEach((ly, lane) => {
      const y = ly + pad;
      for (let u = 0; u < width; u += step) {
        // 一様な線にしない：横にゆっくり変わるノイズで、ところどころ消えかける。両端は消す
        const n = vnoise(u / 180 + lane * 13.7, lane * 3.1);
        const fade = smooth(Math.min(u / fadeLen, (width - u) / fadeLen));
        const a = (0.35 + 0.65 * smooth((n - 0.15) / 0.7)) * fade;
        if (a <= 0.01) continue;
        g.fillStyle = `rgba(150,165,205,${(0.05 * a).toFixed(3)})`;
        g.fillRect(u, y - 2.5, step, 5);
        g.fillStyle = `rgba(150,165,205,${(0.16 * a).toFixed(3)})`;
        g.fillRect(u, y - 0.5, step, 1);
      }
    });
    // 名札の所を、端をなだらかにして消す
    g.globalCompositeOperation = "destination-out";
    for (const gap of this.gaps) {
      const y = (this.laneYs[gap.lane] ?? 0) + pad;
      const soft = 14;
      const grd = g.createLinearGradient(gap.x0 - soft, 0, gap.x1 + soft, 0);
      const span = gap.x1 - gap.x0 + soft * 2;
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(soft / span, "rgba(0,0,0,1)");
      grd.addColorStop(1 - soft / span, "rgba(0,0,0,1)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(gap.x0 - soft, y - 4, span, 8);
    }
    g.globalCompositeOperation = "source-over";
    const rand = seededRandom(23);
    this.glints = [];
    this.laneYs.forEach((_, lane) => {
      for (let k = 0; k < GLINTS_PER_LANE; k++) {
        this.glints.push({ lane, u: ((k + rand()) / GLINTS_PER_LANE) * (width + GLINT_LEN), sp: 0.8 + rand() * 0.4 });
      }
    });
  }

  /** 名札の要素に、出し方と位置を渡す */
  private applyLabel(b: Body, el: HTMLElement) {
    el.toggleAttribute("data-off", !b.on);
    el.toggleAttribute("data-pin", b.pinned);
    el.toggleAttribute("data-fly", b.flyU !== null);
    el.toggleAttribute("data-moving", b.moving);
    el.setAttribute("data-variant", b.variant);
    el.style.setProperty("--w", `${b.width}px`);
    el.style.setProperty("--tx", `${b.dx}px`);
    el.style.setProperty("--ty", `${b.dy}px`);
    if (b.tip) {
      el.style.setProperty("--hw", `${b.tip.width}px`);
      el.style.setProperty("--hx", `${b.tip.dx}px`);
      el.style.setProperty("--hy", `${b.tip.dy}px`);
    }
  }

  /** スマホ：段階ごとに1つの光。列の中心は帯の中の x */
  private layoutStrip(animate: boolean) {
    const centers = this.opt.stripCenters();
    const columns = stripColumns(this.nodes);
    const v = Math.max(18, this.flowRect.height * 0.34);
    const colW = this.flowRect.width / 8;
    this.strip = [];
    this.stripV = v;
    this.bodies.delete(CLUSTER_KEY);
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
        rowText: null,
        deployLinks: [],
        logUrl: null,
        turn: false,
        urgent: false,
      };
      const b = this.place(node, x, v, animate);
      b.count = column.count;
      b.pinned = true;
      b.light = stripLight(this.nodes.filter((n) => n.at === k));
      shown.add(key);
    });
    for (const [key, b] of this.bodies) b.on = shown.has(key);
    for (const el of this.labels.values()) el.setAttribute("data-off", "");
    this.scale = 1;
    // 8つの光の高さに、左端の列から右端の列まで1本の筋を通す（きらめきが走る）
    this.laneTop = 0;
    this.laneYs = [v];
    this.gaps = [];
    this.buildThreads(this.flowRect.width, this.flowRect.height, Math.min(THREAD_FADE, colW * 0.9));
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
    return {
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
      tip: null,
      edgeU: 0,
      fresh: true,
      lastX: NaN,
      lastY: NaN,
      rand: seededRandom(seedOf(node.key)),
      count: 1,
      light: null,
      flyU: null,
      flyUntil: 0,
      trail: [],
      moving: false,
      tailRoom: Infinity,
    };
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
      // スマホの帯：芯のまわりに密に集める（半径×0.6）。PC：名札を出す光は 3.5〜7px、公開済みの塊は 5〜11px（描くとき×0.65）
      if (this.mobile) p.r = (5 + r() * 9) * 0.6;
      else p.r = b.pinned ? 3.5 + r() * 3.5 : 5 + r() * 6;
      p.w = (0.3 + r() * 0.4) * (r() < 0.5 ? 1 : -1);
    } else if (type === "comet") {
      p.len = this.mobile || spawn ? 34 + r() * 20 : 24 + r() * 16;
      p.sp = 0.6 + r() * 0.5;
    } else if (type === "exit") {
      p.sp = 0.22 + r() * 0.16;
    } else if (type === "wide") {
      p.r = 10 + r() * 10;
      p.w = (0.12 + r() * 0.15) * (r() < 0.5 ? 1 : -1);
    } else {
      p.r = 3.5 + r() * 3.5;
    }
    return p;
  }

  private seedKey(b: Body): string {
    return `${b.node.who}:${b.light?.grains ?? ""}:${b.pinned ? 1 : 0}:${b.node.urgent ? 1 : 0}:${this.mobile ? 1 : 0}`;
  }

  private seedParts(b: Body) {
    const who = b.node.who;
    let mix: [ParticleType, number][];
    if (this.mobile) {
      // スマホの帯：1色の塊。同じ色の粒だけを、芯のまわりに密に回す
      mix = [["orbit", b.light?.grains ?? 0]];
    } else if (b.node.key === CLUSTER_KEY) {
      // 公開済みの塊：小さく静か
      mix = [["orbit", 6]];
    } else if (b.pinned) {
      // 常に名札を出す光：人間は回る粒、失敗は震える粒。急ぐ物だけ多い
      mix = who === "fail" ? [["still", b.node.urgent ? 20 : 12]] : [["orbit", b.node.urgent ? 28 : 18]];
    } else {
      // 名札を出さない光：筋の上を進む1つの光。後ろへ抜ける小さな粒だけ（群れにしない）。待機は止まっている
      mix = who === "queue" ? [] : [["comet", 5]];
    }
    b.parts = [];
    for (const [type, count] of mix) {
      for (let m = 0; m < Math.round(count); m++) b.parts.push(this.mkPart(b, type, false));
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
    const rolling = this.gRoll < 1;
    if (document.hidden || (!this.flowVisible && !rolling && !this.dirty)) {
      // タブが見えない・流れが画面の外：止める（また見えたら wake で続ける）
      this.running = false;
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    const reduced = this.opt.isReduced();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.W !== innerWidth || this.H !== innerHeight) this.resize();
    if (!this.flowVisible) {
      // 流れが画面の外：川は止めたまま1回だけ描き直し（誌面の下で暗くする）、数字の転がりだけ動かす
      if (this.dirty) {
        this.dirty = false;
        this.draw(now, 0, true);
      } else {
        this.drawGiant(now, 0, true, this.giantRect());
      }
      return;
    }
    if (reduced && !this.dirty && !rolling) return;
    this.dirty = false;
    if (!reduced) this.t += dt;
    this.draw(now, dt, reduced);
  };

  /** 巨大な数字の箱（文字の高さ）の、画面の中の位置（無ければ null） */
  private giantRect(): Zone | null {
    const g = this.giant;
    if (!g || !this.gReady || !this.gMetrics) return null;
    const r = g.canvas.getBoundingClientRect();
    const top = r.top + this.gPad;
    return { x0: r.left, x1: r.left + this.gW, y0: top, y1: top + this.gH };
  }

  /** 灯りの区域：数字の左から、押す列の手前まで（文字・ボタンの上で灯らない） */
  private litZone(g: Zone | null): Zone | null {
    if (!g || !this.giant) return null;
    const edge = this.giant.litEdge();
    return { x0: g.x0 - CURRENT_IN, x1: Math.max(g.x1, edge), y0: g.y0 - LIT_ABOVE, y1: g.y1 + LIT_BELOW };
  }

  /** 区域の中なら1、端の30pxで0へ */
  private litIn(z: Zone, x: number, y: number): number {
    return smooth(Math.min(x - z.x0, z.x1 - x, y - z.y0, z.y1 - y) / LIT_FADE);
  }

  private draw(now: number, dt: number, reduced: boolean) {
    const { rctx, W, H, t, sprites } = this;
    const band = this.el.band;
    this.bandTop = band ? band.getBoundingClientRect().top + 30 : Infinity;
    const bandTop = this.bandTop;
    const gRect = this.giantRect();
    const zone = this.litZone(gRect);
    const mask = this.gMask;
    const decay = Math.exp(-HEAT_DECAY * dt);
    rctx.clearRect(0, 0, W, H);
    rctx.globalCompositeOperation = "lighter";
    // 川（数字を通った粒は灯り、灯ったまま流れていく。灯って見えるのは灯りの区域の中だけ）
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
        const lx = Math.floor(p.x - gRect.x0);
        const ly = Math.floor(p.y - gRect.y0);
        if (lx >= 0 && ly >= 0 && lx < this.gW && ly < this.gH && mask[ly * this.gW + lx] === 1) p.heat = 1;
      }
      const tw = 0.55 + 0.45 * Math.sin(t * 1.1 + p.ph);
      let a = 0.15 * tw;
      if (p.y > bandTop) a *= 0.3;
      const heat = p.heat > 0.02 && zone ? p.heat * this.litIn(zone, p.x, p.y) : 0;
      if (heat > 0.02) {
        rctx.globalAlpha = Math.min(1, a + 0.55 * heat);
        const sz = 4 * p.s * (1 + 0.8 * heat);
        rctx.drawImage(sprites.amber, p.x - sz / 2, p.y - sz / 2, sz, sz);
        continue;
      }
      rctx.globalAlpha = a;
      const sz = 4 * p.s;
      rctx.drawImage(sprites.river, p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    if (this.laneYs.length > 0) this.drawThreads(dt, reduced);
    if (this.mobile) this.drawEmptyDots(bandTop);
    // 光と粒
    const sc = this.mobile ? 1 : this.scale;
    for (const b of this.bodies.values()) {
      if (!b.on) continue;
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
      if (!this.mobile) {
        this.moveLabel(b);
        // 動いている間は名札を隠す（着いてから出す）
        const moving = b.flyU !== null || Math.hypot(b.pu - b.u, b.pv - b.v) > MOVING_PX;
        if (moving !== b.moving) {
          b.moving = moving;
          this.labels.get(b.node.key)?.toggleAttribute("data-moving", moving);
        }
      }
      this.drawTrail(b.trail, b.node.who, dt, bandTop);
      if (this.mobile) this.drawStripBody(b, x, y, bandTop);
      else this.drawBody(b, x, y, sc, bandTop);
      this.drawParts(b, x, y, sc, dt, reduced, bandTop);
    }
    if (gRect && mask && zone) this.drawCurrent(dt, gRect, zone, mask, reduced, decay);
    this.drawSparks(now, dt, bandTop);
    rctx.globalAlpha = 1;
    rctx.globalCompositeOperation = "source-over";
    if (this.fogDirty) this.drawFog();
    this.drawGiant(now, dt, reduced, gRect);
    if (this.sparks.length > 0 || this.hasTrails()) this.dirty = true;
  }

  /** 光の筋と、筋の上を走るきらめき（流れの中だけ） */
  private drawThreads(dt: number, reduced: boolean) {
    const { rctx } = this;
    const [x0, y0] = this.toXY(0, this.laneTop - 4);
    const width = this.flowRect.width;
    rctx.globalAlpha = 1;
    // 筋のある所（レーンの高さの8px）だけを重ねる（画像の大部分は透明。重ね合わせの面積を減らす）
    const dpr = this.DPR;
    for (const ly of this.laneYs) {
      rctx.drawImage(this.threads, 0, Math.round(ly * dpr), this.threads.width, Math.round(8 * dpr), x0, y0 + ly, width, 8);
    }
    for (const gl of this.glints) {
      if (!reduced) gl.u += GLINT_SPEED * gl.sp * dt;
      if (gl.u - GLINT_LEN > width) gl.u = -this.riverRand() * width * 0.4;
      let fade = smooth(Math.min((gl.u - GLINT_LEN * 0.5) / THREAD_FADE, (width - gl.u) / THREAD_FADE));
      // 名札の所では消える（文字の下を光が走らない）
      for (const gap of this.gaps) {
        if (gap.lane !== gl.lane) continue;
        const d = Math.max(gap.x0 - gl.u, gl.u - GLINT_LEN * 0.4 - gap.x1);
        fade *= smooth(d / 24);
      }
      if (fade <= 0.01) continue;
      const [x, y] = this.toXY(gl.u - GLINT_LEN, this.laneTop + (this.laneYs[gl.lane] ?? 0) - 4);
      rctx.globalAlpha = 0.42 * fade;
      rctx.drawImage(this.sprites.glint, x, y, GLINT_LEN, 8);
    }
  }

  /** PC の光：芯・にじみ・光の尾 */
  private drawBody(b: Body, x: number, y: number, sc: number, bandTop: number) {
    const { rctx, sprites } = this;
    const who = b.node.who;
    const dim = y > bandTop ? 0.3 : 1;
    const cluster = b.node.key === CLUSTER_KEY;
    const urgent = b.node.urgent;
    let glow: number;
    let radius: number;
    let core: number;
    if (cluster) {
      glow = 0.14;
      radius = 12;
      core = 4.5;
    } else if (b.pinned) {
      glow = urgent ? 0.55 : 0.32;
      radius = (who === "human" ? 20 : 16) * sc * (urgent ? 1.3 : 1);
      core = (who === "human" ? 7.5 : 6) * sc;
    } else {
      glow = who === "queue" ? 0.16 : who === "human" ? 0.3 : 0.26;
      radius = (who === "queue" ? 16 : 14) * sc;
      core = 5.5 * sc;
    }
    // 光の尾：光の後ろ（左）の筋を、誰の番かの色で明るくする
    const tail = cluster ? 0 : Math.min(TAIL_LEN[who] * sc, b.tailRoom);
    if (tail > 0) {
      rctx.globalAlpha = 0.5 * dim * (1 + b.hl * 0.4);
      rctx.drawImage(sprites[`${who}_tail`], x - tail, y - 2, tail, 4);
    }
    const g = (glow + b.hl * 0.35) * dim;
    const gr = radius + b.hl * 10;
    rctx.globalAlpha = g;
    rctx.drawImage(sprites[`${who}_glow`], x - gr, y - gr, gr * 2, gr * 2);
    rctx.globalAlpha = (who === "queue" ? 0.7 : cluster ? 0.8 : 1) * dim;
    rctx.drawImage(sprites[who], x - core / 2, y - core / 2, core, core);
  }

  /** スマホの帯の光：1色の芯とにじみ（粒は drawParts）。にじみを大きくするのは急ぐ物がある列だけ */
  private drawStripBody(b: Body, x: number, y: number, bandTop: number) {
    const { rctx, sprites } = this;
    const light = b.light;
    if (!light?.who) return;
    const who = light.who;
    const dim = y > bandTop ? 0.3 : 1;
    const glow = light.urgent ? 0.55 : 0.26;
    const radius = light.urgent ? 20 : light.core * 1.6;
    const gr = radius + b.hl * 10;
    rctx.globalAlpha = (glow + b.hl * 0.35) * dim;
    rctx.drawImage(sprites[`${who}_glow`], x - gr, y - gr, gr * 2, gr * 2);
    rctx.globalAlpha = (who === "queue" ? 0.7 : 1) * dim;
    rctx.drawImage(sprites[who], x - light.core / 2, y - light.core / 2, light.core, light.core);
  }

  /** スマホの帯：0件の列は、筋の上に小さな点（`--mute`）だけ */
  private drawEmptyDots(bandTop: number) {
    const { rctx, sprites } = this;
    this.strip.forEach((col) => {
      if (col.count > 0) return;
      const [x, y] = this.toXY(col.x, this.stripV);
      rctx.globalAlpha = (y > bandTop ? 0.3 : 1) * 0.8;
      rctx.drawImage(sprites.mute, x - 2, y - 2, 4, 4);
    });
  }

  /** 光の周りの粒（回る・震える・後ろへ抜ける） */
  private drawParts(b: Body, x: number, y: number, sc: number, dt: number, reduced: boolean, bandTop: number) {
    const { rctx, sprites, t } = this;
    const who = b.node.who;
    const cluster = b.node.key === CLUSTER_KEY;
    const psc = cluster ? 1 : sc;
    for (let k = b.parts.length - 1; k >= 0; k--) {
      const p = b.parts[k];
      let du: number;
      let dv: number;
      let a: number;
      if (p.type === "orbit" || p.type === "wide" || p.type === "still") {
        if (!reduced) p.a += p.w * dt;
        const rr = p.r * psc * (1 + b.hl * 0.3) * (cluster ? 0.75 * 0.65 : 1);
        const jx = p.type === "still" ? Math.sin(t * 9 + p.ph) * 0.8 : 0;
        // 名札の側（光の右）へは張り出さない
        const raw = Math.cos(p.a) * rr + jx;
        du = this.mobile ? raw : squeezeTowardLabel(raw);
        dv = Math.sin(p.a) * rr * 0.62;
        a = (who === "queue" ? 0.5 : cluster ? 0.5 : 0.85) * (0.6 + 0.4 * Math.sin(t * 1.6 + p.ph));
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
        // 後ろ（左）へ抜ける。名札（右）の上を通らない。PC は筋から上下2pxまで（粒の群れにしない）
        du = -p.p * (this.mobile ? p.len * 0.5 : Math.min(p.len, b.tailRoom));
        dv = this.mobile || p.spawned ? p.off * 14 * (1 - p.p) + Math.sin(p.p * 6 + p.ph) * 2 : p.off * 4 * 0.65 * (1 - p.p);
        a = (1 - p.p) * (this.mobile || p.spawned ? 0.9 : 0.6);
      } else {
        if (!reduced) p.p += dt * p.sp;
        if (p.p >= 1) {
          p.p = 0;
          p.off = b.rand() - 0.5;
        }
        // 公開済み（スマホの帯）：列の右端まで抜けて消える（ほかの列に入らない）
        const edge = Math.max(8, b.edgeU - b.pu);
        du = p.p * p.p * edge;
        dv = p.off * 18 + Math.sin(p.p * 8 + p.ph) * 3;
        a = (1 - p.p) * 0.55;
      }
      const px = x + du;
      const py = y + dv;
      if (py > bandTop) a *= 0.3;
      rctx.globalAlpha = Math.max(0, a);
      const sz = (cluster ? 2.4 : 3) * p.s * Math.min(1.3, psc);
      rctx.drawImage(sprites[who], px - sz / 2, py - sz / 2, sz, sz);
    }
  }

  /**
   * 数字の高さの帯を流れる川の粒：数字の左から入り、数字を通ると灯って、灯ったまま右へ抜けて冷める。
   * 流れが数字の中を通っていることを見せる（川と同じ式・同じ速さ）。灯りの区域の右端で消える
   */
  private drawCurrent(dt: number, rect: Zone, zone: Zone, mask: Uint8Array, reduced: boolean, decay: number) {
    const { rctx, sprites, t } = this;
    const out = Math.min(this.gW + CURRENT_OUT, zone.x1 - rect.x0);
    for (const p of this.gCurrent) {
      if (!reduced) {
        const q = { x: rect.x0 + p.x, y: rect.y0 + p.y, sp: p.sp, vx: 0, vy: 0 };
        this.flowStep(q, dt, t);
        p.x = q.x - rect.x0;
        p.y = q.y - rect.y0;
        p.heat *= decay;
        if (p.x > out || p.y < -8 || p.y > this.gH + 8) {
          p.x = -CURRENT_IN * this.gRand();
          p.y = this.gRand() * this.gH;
          p.heat = 0;
        }
      }
      if (p.x > out) continue;
      const lx = Math.floor(p.x);
      const ly = Math.floor(p.y);
      if (lx >= 0 && ly >= 0 && lx < this.gW && ly < this.gH && mask[ly * this.gW + lx] === 1) p.heat = 1;
      // 端では薄く（入り口と出口で急に現れない・消えない）
      const edge = Math.max(0, Math.min(1, (p.x + CURRENT_IN) / 30, (out - p.x) / 40));
      const tw = 0.55 + 0.45 * Math.sin(t * 1.1 + p.ph);
      if (p.heat > 0.02) {
        rctx.globalAlpha = Math.max(0, Math.min(1, (0.08 * tw + 0.7 * p.heat) * edge));
        const sz = 4 * p.s * (1 + 0.6 * p.heat);
        rctx.drawImage(sprites.amber, rect.x0 + p.x - sz / 2, rect.y0 + p.y - sz / 2, sz, sz);
      } else {
        rctx.globalAlpha = Math.max(0, 0.22 * tw * edge);
        const sz = 4 * p.s;
        rctx.drawImage(sprites.river, rect.x0 + p.x - sz / 2, rect.y0 + p.y - sz / 2, sz, sz);
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
    const ctx = this.gMeasure.getContext("2d");
    if (!ctx) return;
    // 文字の大きさが読めない（NaN・0。DOM から外れた要素など）ときは、前の有効な値を使い、それも無ければ描かない
    const fs = parseFloat(getComputedStyle(g.canvas.parentElement ?? g.canvas).fontSize);
    if (Number.isFinite(fs) && fs > 0) this.gFs = fs;
    else if (!(this.gFs > 0)) return;
    g.ghost.textContent = String(this.gValue);
    ctx.font = this.giantFont();
    ctx.letterSpacing = "0px"; // 字間 0 で測る（inkRightOf が字間を足す）。字面の測り直しで字間を設定するので、毎回戻す
    const text = String(Math.max(this.gValue, this.gPrev ?? 0));
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent;
    const des = m.actualBoundingBoxDescent;
    this.gW = Math.ceil(m.width - this.gFs * 0.06 * (text.length - 1)) + 4;
    // 数字は gMetrics.left（上の text の左端）から描くので、字面の右端も同じ左端で測る（描く位置と同じ数字の幅）
    const value = String(this.gValue);
    const vm = ctx.measureText(value);
    const estimate = inkRightOf(vm.actualBoundingBoxRight, m.actualBoundingBoxLeft, -0.06 * this.gFs, value.length, 2);
    // measureText の字面の幅は、大きい文字で実際の画素より数px大きく出る。描くのと同じ字を描いて、不透明な画素の右端を測る
    const inkRight = this.measureInkRight(ctx, value, m.actualBoundingBoxLeft, asc, des) ?? estimate;    this.gH = Math.ceil(asc + des) + 8;
    this.gPad = Math.round(this.gH * GIANT_PAD);
    this.gMetrics = { asc, left: m.actualBoundingBoxLeft };
    this.gDpr = Math.min(devicePixelRatio || 1, 2);
    const box = g.canvas.parentElement;
    if (box) {
      box.style.width = `${this.gW}px`;
      box.style.height = `${this.gH}px`;
    }
    const total = this.gH + this.gPad * 2;
    for (const c of [g.canvas, this.gField, this.gTmp, this.gBase]) {
      c.width = Math.round(this.gW * this.gDpr);
      c.height = Math.round(total * this.gDpr);
      c.style.width = `${this.gW}px`;
      c.style.height = `${total}px`;
    }
    // 箱の上下へはみ出して重ねる（転がる数字を、はみ出しの所で消す）
    g.canvas.style.position = "absolute";
    g.canvas.style.left = "0";
    g.canvas.style.top = `${-this.gPad}px`;
    g.canvas.style.pointerEvents = "none";
    this.placeUnit(inkRight);
    this.drawGiantBase();
    this.buildMask();
    this.gRand = seededRandom(11);
    const rand = this.gRand;
    const n = Math.round((this.gW * total) / 260);
    this.gLocal = [];
    for (let k = 0; k < n; k++) {
      this.gLocal.push({ x: rand() * this.gW, y: rand() * total - this.gPad, s: 0.6 + rand() * 1.2, ph: rand() * 6.28, sp: 0.6 + rand() * 0.8, heat: 0, vx: 0, vy: 0 });
    }
    const span = this.gW + CURRENT_IN + CURRENT_OUT;
    this.gCurrent = [];
    for (let k = 0; k < Math.round((span * this.gH) / 900); k++) {
      const x = rand() * span - CURRENT_IN;
      // 最初から、数字を出た粒は灯った名残りがある状態にする（開いた瞬間から流れが見える）
      const heat = x > this.gW * 0.5 ? Math.exp((-HEAT_DECAY * (x - this.gW * 0.5)) / RIVER_SPEED) : 0;
      this.gCurrent.push({ x, y: rand() * this.gH, s: 0.6 + rand() * 1.1, ph: rand() * 6.28, sp: 0.6 + rand() * 0.8, heat, vx: 0, vy: 0 });
    }
  }

  /** 数字を glyph() と同じ位置・字間で描き、不透明な画素の右端（箱の左端から）を返す。読めなければ null */
  private measureInkRight(ctx: CanvasRenderingContext2D, text: string, left: number, asc: number, des: number): number | null {
    const c = this.gMeasure;
    const w = Math.ceil(ctx.measureText(text).width + left + this.gFs) + 8;
    const h = Math.ceil(asc + des) + 8;
    if (!(w > 0) || !(h > 0)) return null;
    c.width = w;
    c.height = h;
    ctx.font = this.giantFont();
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = `${-0.06 * this.gFs}px`;
    ctx.fillStyle = "#fff";
    ctx.fillText(text, left + 2, asc + 4);
    try {
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let x = w - 1; x >= 0; x--) {
        for (let y = 0; y < h; y++) {
          if (data[(y * w + x) * 4 + 3] > 128) return x + 1;
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * 「件」を、新しい数字の字面の右端＋6pxへ置く。
   * 箱の幅は転がり中の大きいほうなので、置き場所（箱の右端＋列の間）から動かして合わせる。
   * 転がるときは、前の位置から始めて数字の転がりと同じ時間で動かす（箱の幅が変わっても跳ばない）
   */
  private placeUnit(inkRight: number) {
    const u = this.giant?.unit;
    if (!u) return;
    const gap = parseFloat(getComputedStyle(u.parentElement ?? u).columnGap) || 0;
    const from = this.gUnitX;
    const to = unitLeft(inkRight);
    this.gUnitX = to;
    const shift = (x: number) => `translateX(${unitShift(x - GIANT_UNIT_GAP, this.gW, gap)}px)`;
    const animate = from !== null && from !== to && this.gRoll < 1 && !this.opt.isReduced();
    u.style.transition = "none";
    u.style.transform = shift(from ?? to);
    if (!animate) {
      u.style.transform = shift(to);
      return;
    }
    void u.getBoundingClientRect();
    u.style.transition = "transform 460ms cubic-bezier(0.215, 0.61, 0.355, 1)";
    u.style.transform = shift(to);
  }

  /** 数字の中の地と、止まった2つの光（数字を描き直すときだけ。はみ出しの所まで） */
  private drawGiantBase() {
    const fc = this.gBase.getContext("2d");
    if (!fc) return;
    const { gW: GW, gH: GH, gDpr: dpr, gPad: pad } = this;
    fc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fc.globalCompositeOperation = "source-over";
    fc.fillStyle = "#2A1804";
    fc.fillRect(0, 0, GW, GH + pad * 2);
    fc.globalCompositeOperation = "lighter";
    const blobs: [string, number, number, number][] = [
      ["255,176,64", 0.9, 0.3, 0.25],
      ["255,118,34", 0.7, 0.75, 0.8],
    ];
    for (const [c, a, bx, by] of blobs) {
      const x = GW * bx;
      const y = pad + GH * by;
      const r = Math.max(GW, GH) * 0.6;
      const grd = fc.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${c},${a})`);
      grd.addColorStop(1, `rgba(${c},0)`);
      fc.fillStyle = grd;
      fc.fillRect(0, 0, GW, GH + pad * 2);
    }
    fc.globalCompositeOperation = "source-over";
  }

  /** 数字の形の型（1倍。箱の中だけ）：川の粒が数字の中にいるかを見る */
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

  private drawGiantField(dt: number, rect: Zone, reduced: boolean, rolling: boolean) {
    const fc = this.gField.getContext("2d");
    if (!fc) return;
    const { gW: GW, gH: GH, gDpr: dpr, gPad: pad, t } = this;
    // ゆらぎの時刻：動きを減らす設定のときだけ止めた値（流れが画面の外で止めているときは、今の時刻のまま）
    const tt = this.opt.isReduced() ? 12 : t;
    fc.setTransform(1, 0, 0, 1, 0, 0);
    fc.globalCompositeOperation = "source-over";
    const [sy, sh] = this.gSpan;
    fc.drawImage(this.gBase, 0, sy, this.gBase.width, sh, 0, sy, this.gBase.width, sh);
    fc.setTransform(dpr, 0, 0, dpr, 0, pad * dpr);
    fc.globalCompositeOperation = "lighter";
    for (const p of this.gLocal) {
      // はみ出しの所の粒は、転がっている間だけ動かして描く（止まった数字は箱の中だけ。計算を増やさない）
      if (!rolling && (p.y < -6 || p.y > GH + 6)) continue;
      if (!reduced) {
        const q = { x: rect.x0 + p.x, y: rect.y0 + p.y, sp: p.sp, vx: 0, vy: 0 };
        this.flowStep(q, dt, t);
        p.x = q.x - rect.x0;
        p.y = q.y - rect.y0;
        p.vx = q.vx;
        p.vy = q.vy;
        if (p.x > GW + 4) {
          p.x = -4;
          p.y = this.gRand() * (GH + pad * 2) - pad;
        }
        if (p.y < -pad - 4) p.y = GH + pad + 4;
        if (p.y > GH + pad + 4) p.y = -pad - 4;
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
      const x = p.x - rect.x0;
      const y = p.y - rect.y0;
      if (x < -4 || y < -pad - 4 || x > GW + 4 || y > GH + pad + 4) continue;
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
    const [sy, sh] = this.gSpan;
    tc.clearRect(0, sy, this.gTmp.width, sh);
    tc.save();
    tc.scale(dpr, dpr);
    tc.font = this.giantFont();
    tc.textBaseline = "alphabetic";
    tc.letterSpacing = `${-0.06 * fs}px`;
    tc.fillStyle = "#fff";
    tc.fillText(text, this.gMetrics.left + 2, this.gPad + this.gMetrics.asc + 4 + dy);
    tc.restore();
    tc.globalCompositeOperation = "source-in";
    tc.drawImage(this.gField, 0, sy, this.gField.width, sh, 0, sy, this.gField.width, sh);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.gTmp, 0, sy, this.gTmp.width, sh, 0, sy, this.gTmp.width, sh);
    ctx.globalAlpha = 1;
  }

  private drawGiant(now: number, dt: number, reduced: boolean, rect: Zone | null) {
    const g = this.giant;
    if (!g || !rect) return;
    const ctx = g.canvas.getContext("2d");
    if (!ctx) return;
    if (this.gRoll < 1) {
      this.gRoll = Math.min(1, (now - this.gRollT0) / 460);
      // 転がり終わったら前の数字の幅を捨て、箱と「件」の位置を今の数字だけで測り直す
      if (this.gRoll >= 1 && this.gPrev !== null) {
        this.gPrev = null;
        this.giantLayout();
      }
    }
    const rolling = this.gRoll < 1 && this.gPrev !== null;
    const dpr = this.gDpr;
    this.gSpan = rolling
      ? [0, g.canvas.height]
      : [Math.max(0, Math.floor(this.gPad * dpr) - 2), Math.min(g.canvas.height, Math.ceil(this.gH * dpr) + 4)];
    this.drawGiantField(dt, rect, reduced, rolling);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, g.canvas.width, g.canvas.height);
    if (rolling && this.gPrev !== null) {
      const p = ease(this.gRoll);
      this.glyph(ctx, String(this.gPrev), -this.gH * 0.9 * p, 1 - p);
      this.glyph(ctx, String(this.gValue), this.gH * 0.9 * (1 - p), p);
      // 上：前の数字は、箱の上のはみ出しの所で外の端へ向けて消える。
      // 下：新しい数字は、箱の下端の手前（高さ×0.3。転がり終わるにつれて0へ）から下端へ向けて現れる。
      // 箱の下にはみ出しては描かない（下の見出しの文字に重ねない）。どちらも四角い切れ目を作らない
      const h = g.canvas.height;
      const top = (this.gPad * this.gDpr) / h;
      const bottom = ((this.gPad + this.gH) * this.gDpr) / h;
      const rise = ((this.gH * 0.3 * (1 - p)) * this.gDpr) / h;
      const fade = ctx.createLinearGradient(0, 0, 0, h);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(top, "rgba(0,0,0,1)");
      fade.addColorStop(Math.max(top, bottom - rise), "rgba(0,0,0,1)");
      fade.addColorStop(bottom, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, g.canvas.width, h);
      ctx.globalCompositeOperation = "source-over";
    } else {
      this.glyph(ctx, String(this.gValue), 0, 1);
    }
  }
}
