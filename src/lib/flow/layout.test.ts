import { describe, expect, it } from "vitest";
import { buildDemoResults } from "../demo/data";
import type { DemoOp } from "../demo/ops";
import { advancePlayback, startPlayback, type DemoPlayback } from "../demo/playback";
import {
  COLUMN_END_MARGIN,
  chooseLabel,
  DOT_OFFSET,
  hoverLabelBox,
  LABEL_GAP,
  hoverLabelHeight,
  labelHeight,
  laneCountOf,
  laneHeightOf,
  layoutFlow,
  MAX_LANES,
  reflowExtraHeight,
  reflowExtraLines,
  STAGES_ROOM,
  stripColumns,
  titleTipBox,
  type FlowLayout,
  type LayoutInput,
  type MeasureLabel,
  type PlacedNode,
} from "./layout";
import { buildFlowNodes, type FlowNode, type FlowWho } from "./nodes";

function node(
  number: number,
  at: number,
  who: FlowWho,
  options: { repo?: string; title?: string; label?: string } = {},
): FlowNode {
  const repo = options.repo ?? "r";
  return {
    key: `o/${repo}#${number}`,
    owner: "o",
    repo,
    number,
    title: options.title ?? `Issue ${number} のタイトル`,
    url: "https://example.com",
    at,
    who,
    label: options.label ?? "名札",
    caption: "",
    rowText: null,
    deployLinks: [],
    logUrl: null,
    turn: who === "human",
    urgent: false,
  };
}

/** 和文1文字 = 文字の大きさ、欧文・数字1文字 = 0.6 として測る（テスト用。少し広め）。番号はリポジトリ名つき */
function measureAt(fontSize: number): MeasureLabel {
  const w = (text: string) => [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 0x2e80 ? 0.6 : 1) * fontSize, 0);
  return (n) => ({ id: w(`${n.repo}#${n.number}`), status: w(n.label), title: w(n.title) });
}

/** デモのデータと同じ並び（30件。人間7・失敗2・AI10・待機3・公開済み8） */
function demoLike(): FlowNode[] {
  const t = "タスクをカレンダーに表示する";
  return [
    node(31, 0, "human", { repo: "todo-app", title: t, label: "保留中" }),
    node(13, 0, "human", { repo: "todo-app", title: t, label: "まだ頼んでいません" }),
    node(7, 2, "human", { repo: "landing-page", title: t, label: "PRを作れます" }),
    node(6, 2, "human", { repo: "landing-page", title: t, label: "AIがエラーで停止" }),
    node(23, 5, "human", { repo: "todo-app", title: t, label: "止まっています" }),
    node(22, 6, "human", { repo: "todo-app", title: t, label: "マージできます" }),
    node(21, 6, "human", { repo: "todo-app", title: t, label: "マージできます" }),
    node(18, 3, "fail", { repo: "todo-app", title: t, label: "CIが失敗しました" }),
    node(9, 7, "fail", { repo: "landing-page", title: "トップの画像を軽くする", label: "公開に失敗しました" }),
    node(24, 0, "ai", { repo: "todo-app", label: "清書中" }),
    node(3, 0, "ai", { repo: "landing-page", label: "清書中" }),
    node(16, 1, "ai", { repo: "todo-app" }),
    node(19, 3, "ai", { repo: "todo-app" }),
    node(20, 4, "ai", { repo: "todo-app" }),
    node(17, 5, "ai", { repo: "todo-app" }),
    node(2, 5, "ai", { repo: "landing-page" }),
    node(5, 6, "ai", { repo: "landing-page" }),
    node(4, 6, "ai", { repo: "landing-page" }),
    node(8, 7, "ai", { repo: "landing-page" }),
    node(25, 1, "queue", { repo: "todo-app" }),
    node(15, 0, "queue", { repo: "todo-app" }),
    node(14, 0, "queue", { repo: "todo-app" }),
    // todo-app#9 と landing-page#9（失敗）は、番号が同じで別の物
    ...[12, 11, 10, 9, 8, 7].map((n) => node(n, 7, "done", { repo: "todo-app" })),
    ...[26, 1].map((n) => node(n, 7, "done", { repo: "landing-page" })),
  ];
}

/** 8つの大きさの流れ（幅は左右の余白を除く、高さは光の区域 = --flow-h − 56px） */
const SIZES = [
  { name: "1024×768", width: 984, height: 144, fontSize: 11.55, overhang: 20 },
  { name: "1280×800", width: 1224, height: 152, fontSize: 12.14, overhang: 28 },
  { name: "1440×900", width: 1376, height: 178, fontSize: 12.5, overhang: 32 },
  { name: "1920×1080", width: 1840, height: 225, fontSize: 13.6, overhang: 40 },
  { name: "2560×1080", width: 2480, height: 225, fontSize: 15, overhang: 40 },
  { name: "2560×1440", width: 2480, height: 318, fontSize: 15, overhang: 40 },
];

type Size = (typeof SIZES)[number];

function input(size: Size, nodes: FlowNode[], prev: FlowLayout | null = null): LayoutInput {
  return { nodes, ...size, measure: measureAt(size.fontSize), prev: prev?.next ?? null };
}

function run(size: Size, nodes = demoLike(), prev: FlowLayout | null = null): FlowLayout {
  return layoutFlow(input(size, nodes, prev));
}

function labelRect(
  p: { x: number; y: number; dx: number; dy: number; width: number },
  fontSize: number,
  height = labelHeight(fontSize),
) {
  return { x0: p.x + p.dx, x1: p.x + p.dx + p.width, y0: p.y + p.dy, y1: p.y + p.dy + height };
}

function overlaps(a: ReturnType<typeof labelRect>, b: ReturnType<typeof labelRect>): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function positions(layout: FlowLayout): Map<string, string> {
  return new Map(layout.placed.map((p) => [p.key, `${p.x.toFixed(2)},${p.y.toFixed(2)}`]));
}

describe("layoutFlow", () => {
  for (const size of SIZES) {
    describe(`幅 ${size.name}`, () => {
      const layout = run(size);
      const nodes = demoLike();
      const byKey = new Map(nodes.map((n) => [n.key, n]));
      const pinned = layout.placed.filter((p) => p.pinned);
      const dots = layout.placed.filter((p) => !p.pinned);

      it("公開済み以外の光を全部出し、光は必ず自分の段階の列の中の、レーン（光の筋）の上にある", () => {
        expect(layout.hidden).toEqual([]);
        expect(layout.placed).toHaveLength(nodes.filter((n) => n.who !== "done").length);
        expect(layout.lanes).toBeLessThanOrEqual(MAX_LANES);
        for (const p of layout.placed) {
          const at = byKey.get(p.key)?.at ?? -1;
          expect(p.column).toBe(at);
          expect(p.x).toBeGreaterThanOrEqual(at * layout.columnWidth + DOT_OFFSET - 0.01);
          expect(p.x).toBeLessThanOrEqual((at + 1) * layout.columnWidth - COLUMN_END_MARGIN + 0.01);
          expect(p.y).toBe(layout.laneYs[p.lane]);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(size.height);
        }
      });

      it("公開済みは右の余白の1つの塊にまとめる", () => {
        const done = nodes.filter((n) => n.who === "done").map((n) => n.key);
        expect(layout.cluster?.keys).toEqual(done);
        expect(layout.cluster?.x).toBeGreaterThan(size.width);
        expect(layout.cluster?.x).toBeLessThan(size.width + size.overhang);
        expect(layout.cluster?.y).toBe(layout.laneYs[layout.cluster?.lane ?? -1]);
      });

      it("常に名札を出すのは、人間の番と失敗だけ", () => {
        expect(pinned).toHaveLength(9);
        expect(pinned.every((p) => ["human", "fail"].includes(byKey.get(p.key)?.who ?? ""))).toBe(true);
      });

      it("常に出す名札は光の右（反転しない）で、右端からはみ出さず、ほかの名札とも、ほかの光とも重ならない", () => {
        for (const p of pinned) {
          expect(p.dx).toBe(LABEL_GAP);
          expect(p.x + p.dx + p.width).toBeLessThanOrEqual(size.width + size.overhang);
          expect(p.width).toBeGreaterThan(size.fontSize * 5);
        }
        for (const a of pinned) {
          const ra = labelRect(a, size.fontSize);
          for (const b of pinned) {
            if (a !== b) expect(overlaps(ra, labelRect(b, size.fontSize)), `${a.key} と ${b.key}`).toBe(false);
          }
          for (const d of layout.placed) {
            if (d === a) continue;
            const inside = d.x >= ra.x0 - 4 && d.x <= ra.x1 + 4 && d.y >= ra.y0 && d.y <= ra.y1;
            expect(inside, `${d.key} が ${a.key} の名札の下`).toBe(false);
          }
          const c = layout.cluster;
          if (c) expect(c.x >= ra.x0 - 4 && c.x <= ra.x1 + 4 && c.y >= ra.y0 && c.y <= ra.y1).toBe(false);
        }
      });

      it("常に出す名札は1行（高さは1行ぶん）で、題名は出さない（題名の札は乗せたときだけ）", () => {
        for (const p of pinned) {
          expect(p.variant, p.key).toBe("full");
          expect(p.tip, p.key).not.toBeNull();
        }
        expect(dots.every((p) => p.tip === null)).toBe(true);
        expect(labelHeight(size.fontSize)).toBeCloseTo(size.fontSize * 1.25 + 4);
      });

      it("題名の札は、ほかの常に出す名札と重ならず、自分の名札にもかからず、区域と右端からはみ出さない", () => {
        for (const a of pinned) {
          const tip = a.tip;
          if (!tip) throw new Error(a.key);
          const r = labelRect({ ...a, ...tip }, size.fontSize);
          expect(r.x1).toBeLessThanOrEqual(size.width + size.overhang + 0.01);
          expect(r.x0).toBeGreaterThanOrEqual(-0.01);
          expect(r.y0).toBeGreaterThanOrEqual(-STAGES_ROOM - 0.01);
          expect(r.y1).toBeLessThanOrEqual(size.height + 0.01);
          expect(overlaps(r, labelRect(a, size.fontSize)), `${a.key} の自分の名札`).toBe(false);
          for (const b of pinned) {
            if (a !== b) expect(overlaps(r, labelRect(b, size.fontSize)), `${a.key} の題名と ${b.key}`).toBe(false);
          }
        }
      });

      it("同じレーンの光どうしは離れている", () => {
        for (const a of layout.placed) {
          for (const b of layout.placed) {
            if (a === b || a.lane !== b.lane) continue;
            expect(Math.abs(a.x - b.x), `${a.key} と ${b.key}`).toBeGreaterThanOrEqual(10);
          }
        }
      });

      it("乗せたときの名札は、右端からはみ出さず、常に出ている名札と重ならない側に出る（左右の反転はしない）", () => {
        const boxes: (PlacedNode | NonNullable<FlowLayout["cluster"]>)[] = [...dots];
        const crowded: string[] = [];
        if (layout.cluster) boxes.push(layout.cluster);
        for (const p of boxes) {
          const r = labelRect(p, size.fontSize, hoverLabelHeight(size.fontSize));
          expect(r.x1).toBeLessThanOrEqual(size.width + size.overhang + 0.01);
          expect(r.x0).toBeGreaterThanOrEqual(-0.01);
          expect(r.y1).toBeLessThanOrEqual(size.height + 0.01);
          expect(r.y0).toBeGreaterThanOrEqual(-STAGES_ROOM - 0.01);
          // 光そのものは隠さない
          expect(p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1).toBe(false);
          if (pinned.some((q) => overlaps(r, labelRect(q, size.fontSize)))) crowded.push("key" in p ? p.key : "公開済み");
        }
        // どの側も常に出す名札でふさがっているときだけ、重なりのいちばん小さい所に出る（1024×768 の右端の1つ）
        expect(crowded.length, crowded.join(", ")).toBeLessThanOrEqual(size.width < 1000 ? 1 : 0);
      });

      it("前の配置を渡すと、何も変わっていなければ全部同じ位置", () => {
        const again = run(size, nodes, layout);
        expect(positions(again)).toEqual(positions(layout));
        expect(again.cluster?.y).toBe(layout.cluster?.y);
      });

      it("1つが次の段階へ進んでも、ほかの光と名札は動かない。進んだ物は同じレーンに置く", () => {
        const moved = nodes.map((n) => (n.key === "o/todo-app#19" ? { ...n, at: 4 } : n));
        const next = run(size, moved, layout);
        const before = positions(layout);
        const after = positions(next);
        for (const [key, pos] of before) if (key !== "o/todo-app#19") expect(after.get(key), key).toBe(pos);
        const was = layout.placed.find((p) => p.key === "o/todo-app#19");
        const now = next.placed.find((p) => p.key === "o/todo-app#19");
        expect(now?.column).toBe(4);
        expect(now?.lane).toBe(was?.lane);
        for (const p of layout.placed.filter((q) => q.pinned)) {
          const q = next.placed.find((r) => r.key === p.key);
          expect(q?.width, p.key).toBe(p.width);
        }
      });

      it("押した人間の番が AI の番になって次の列へ進んでも（PRを作る）、ほかは動かない", () => {
        const moved = nodes.map((n) => (n.key === "o/landing-page#6" ? { ...n, at: 3, who: "ai" as const, label: "CI 実行中" } : n));
        const next = run(size, moved, layout);
        const before = positions(layout);
        const after = positions(next);
        for (const [key, pos] of before) if (key !== "o/landing-page#6") expect(after.get(key), key).toBe(pos);
        expect(next.placed.find((p) => p.key === "o/landing-page#6")).toMatchObject({ column: 3, pinned: false });
      });

      it("新しい Issue が増えても、消えても、ほかは動かない", () => {
        const added = run(size, [...nodes, node(40, 1, "ai", { repo: "todo-app" }), node(41, 4, "human", { repo: "todo-app" })], layout);
        const before = positions(layout);
        const after = positions(added);
        for (const [key, pos] of before) expect(after.get(key), key).toBe(pos);
        const removed = run(size, nodes.filter((n) => n.key !== "o/todo-app#24"), layout);
        for (const [key, pos] of positions(removed)) expect(pos, key).toBe(before.get(key));
      });
    });
  }

  it("デモの再生と押す操作を通しても、変わった物以外の光は動かない", () => {
    const size = SIZES[2];
    const now = new Date("2026-10-26T03:00:00Z");
    let playback: DemoPlayback = startPlayback(now);
    let nodes = buildFlowNodes(buildDemoResults(now, playback), now);
    let layout = run(size, nodes);
    const press = (op: Omit<DemoOp, "owner" | "at">) => {
      playback = { ...playback, ops: [...playback.ops, { owner: "demo", at: playback.now, ...op }] };
    };
    const steps: (() => void)[] = [
      ...Array.from({ length: 4 }, () => () => {
        playback = advancePlayback(playback);
      }),
      () => press({ repo: "landing-page", number: 6, kind: "createPull" }),
      () => press({ repo: "todo-app", number: 23, kind: "resume" }),
      () => press({ repo: "todo-app", number: 22, kind: "merge" }),
      ...Array.from({ length: 5 }, () => () => {
        playback = advancePlayback(playback);
      }),
    ];
    for (const step of steps) {
      step();
      const next = buildFlowNodes(buildDemoResults(now, playback), now);
      const nextLayout = run(size, next, layout);
      const was = new Map(nodes.map((n) => [n.key, n]));
      const before = positions(layout);
      for (const p of nextLayout.placed) {
        const old = was.get(p.key);
        if (!old || old.at !== p.column || !before.has(p.key)) continue;
        expect(`${p.x.toFixed(2)},${p.y.toFixed(2)}`, p.key).toBe(before.get(p.key));
      }
      nodes = next;
      layout = nextLayout;
    }
  });

  it("レーンの数が変わる（画面の高さが変わる）ときは置き直す", () => {
    const small = run({ ...SIZES[2], height: 100 });
    const tall = run(SIZES[2], demoLike(), small);
    expect(tall.lanes).toBeGreaterThan(small.lanes);
    expect(tall.hidden).toEqual([]);
  });

  it("レーンの数は区域の高さで決まり、多すぎない", () => {
    expect(laneCountOf(144, 11.55)).toBe(7);
    expect(laneCountOf(178, 12.5)).toBe(8);
    expect(laneCountOf(225, 13.6)).toBe(8);
    expect(laneCountOf(318, 15)).toBe(8);
    expect(laneCountOf(600, 15)).toBe(MAX_LANES);
    expect(laneCountOf(10, 12)).toBe(1);
  });

  it("レーンの高さは1行の名札に合わせる（名札の高さ＋2px）", () => {
    expect(labelHeight(12)).toBe(19);
    expect(laneHeightOf(12)).toBe(21);
    expect(hoverLabelHeight(12)).toBe(34);
  });

  it("1024×768・1440×900・2560×1440 の光の筋は、1行の名札にしたぶん増える（4・4・6本から）", () => {
    for (const [size, lanes] of [[SIZES[0], 7], [SIZES[2], 8], [SIZES[5], 8]] as const) {
      const layout = run(size);
      expect(layout.lanes, size.name).toBe(lanes);
      expect(layout.laneYs, size.name).toHaveLength(lanes);
      // レーンどうしは、1行の名札が重ならない間隔
      for (let l = 1; l < layout.laneYs.length; l++) {
        expect(layout.laneYs[l] - layout.laneYs[l - 1], size.name).toBeGreaterThanOrEqual(laneHeightOf(size.fontSize) - 0.01);
      }
      expect(layout.laneYs[0]).toBeGreaterThanOrEqual(labelHeight(size.fontSize) / 2 - 0.01);
      expect(layout.laneYs[lanes - 1]).toBeLessThanOrEqual(size.height - labelHeight(size.fontSize) / 2 + 0.01);
    }
  });

  it("同じ列の常に出す名札は別のレーンで、区域の真ん中に寄せる", () => {
    const nodes = [node(1, 2, "human"), node(2, 2, "human")];
    const layout = layoutFlow({ nodes, width: 1200, height: 160, fontSize: 12, overhang: 30, measure: measureAt(12) });
    const [a, b] = layout.placed;
    expect(a.lane).not.toBe(b.lane);
    expect(Math.abs((a.y + b.y) / 2 - 80)).toBeLessThan(layout.laneHeight);
  });

  it("左の列の名札がかかっているレーンは避ける", () => {
    const long = "とても長いタイトルがずっと続いていて隣の列まで伸びる";
    const nodes = [node(1, 0, "human", { label: long }), node(2, 1, "human", { label: long })];
    const layout = layoutFlow({ nodes, width: 800, height: 160, fontSize: 12, overhang: 20, measure: measureAt(12) });
    const [a, b] = layout.placed;
    expect(a.lane).not.toBe(b.lane);
  });

  it("名札を出さない光は、同じレーンの上に間隔をあけて並ぶ（点の群れにしない）", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node(i + 1, 1, "ai"));
    const layout = layoutFlow({ nodes, width: 1376, height: 178, fontSize: 12.5, overhang: 32, measure: measureAt(12.5) });
    expect(layout.hidden).toEqual([]);
    const lanes = new Set(layout.placed.map((p) => p.lane));
    expect(lanes.size).toBe(layout.lanes);
    for (const p of layout.placed) expect(layout.laneYs).toContain(p.y);
  });

  it("名札を出さない光が列に入らないときは間隔を詰め、それでも入らない物は出さない", () => {
    const many = Array.from({ length: 40 }, (_, i) => node(i + 1, 3, "ai"));
    const roomy = layoutFlow({ nodes: many, width: 1376, height: 178, fontSize: 12.5, overhang: 30, measure: measureAt(12.5) });
    expect(roomy.hidden).toEqual([]);
    const cramped = layoutFlow({ nodes: many, width: 600, height: 40, fontSize: 12.5, overhang: 30, measure: measureAt(12.5) });
    expect(cramped.hidden.length).toBeGreaterThan(0);
    expect(cramped.placed.length + cramped.hidden.length).toBe(40);
  });

  it("右の列の常に出す名札は、入らなくても1行のまま（右端で切る）", () => {
    const n = node(9, 7, "fail", { repo: "landing-page", label: "公開に失敗しました" });
    const layout = layoutFlow({ nodes: [n], width: 984, height: 144, fontSize: 11.55, overhang: 20, measure: measureAt(11.55) });
    const p = layout.placed[0];
    expect(p).toMatchObject({ pinned: true, variant: "full", dx: LABEL_GAP });
    expect(p.x + p.dx + p.width).toBeLessThanOrEqual(984 + 20);
  });

  it("0件でも壊れない", () => {
    const layout = layoutFlow({ nodes: [], width: 800, height: 150, fontSize: 12, overhang: 20, measure: measureAt(12) });
    expect(layout.placed).toEqual([]);
    expect(layout.hidden).toEqual([]);
    expect(layout.cluster).toBeNull();
  });
});

describe("hoverLabelBox", () => {
  const base = { fontSize: 12, height: 160, rightEdge: 1000 };
  const lh = hoverLabelHeight(12);
  const m = { id: 50, status: 60, title: 188 };
  it("空いていれば光の右に2行", () => {
    expect(hoverLabelBox(100, 80, m, { ...base, avoid: [] })).toEqual({ dx: LABEL_GAP, dy: -lh / 2, width: 200, variant: "full" });
  });
  it("右に常に出す名札があれば、下か上へ", () => {
    const avoid = [{ x0: 200, x1: 400, y0: 80 - lh / 2, y1: 80 + lh / 2 }];
    const box = hoverLabelBox(100, 80, m, { ...base, avoid });
    const r = { x0: 100 + box.dx, x1: 100 + box.dx + box.width, y0: 80 + box.dy, y1: 80 + box.dy + lh };
    expect(r.x0 < 400 && r.x1 > 200 && r.y0 < 80 + lh / 2 && r.y1 > 80 - lh / 2).toBe(false);
    expect(100 > r.x0 && 100 < r.x1 && 80 > r.y0 && 80 < r.y1).toBe(false);
  });
  it("右端に入らなければ、左へずらして下（反転はしない）", () => {
    const box = hoverLabelBox(950, 40, m, { ...base, avoid: [] });
    expect(950 + box.dx + box.width).toBeLessThanOrEqual(1000);
    expect(box.dy).toBe(12);
  });
  it("どの側も2行では重なるなら、縦に積む出し方で空いた所を探す", () => {
    const avoid = [
      { x0: 0, x1: 1000, y0: 0, y1: 60 },
      { x0: 0, x1: 1000, y0: 100, y1: 160 },
      { x0: 260, x1: 1000, y0: 60, y1: 100 },
    ];
    const box = hoverLabelBox(100, 80, m, { ...base, avoid });
    expect(box).toMatchObject({ variant: "stack", dx: LABEL_GAP, dy: -lh / 2 });
  });
});

describe("titleTipBox", () => {
  const base = { fontSize: 12, height: 160, rightEdge: 1000 };
  const lh = labelHeight(12);
  const m = { id: 50, status: 60, title: 188 };
  it("空いていれば名札の真下（2行目）に出す", () => {
    expect(titleTipBox(100, 80, m, { ...base, avoid: [] })).toEqual({ dx: LABEL_GAP, dy: lh / 2, width: 200 });
  });
  it("真下がふさがっていれば真上、それもふさがっていれば1行ずつ離す", () => {
    const below = { x0: 0, x1: 1000, y0: 80 + lh / 2, y1: 80 + lh * 1.5 };
    expect(titleTipBox(100, 80, m, { ...base, avoid: [below] })).toMatchObject({ dy: -lh * 1.5 });
    const above = { x0: 0, x1: 1000, y0: 80 - lh * 1.5, y1: 80 - lh / 2 };
    expect(titleTipBox(100, 80, m, { ...base, avoid: [below, above] })).toMatchObject({ dy: lh * 1.5 });
  });
  it("乗せた名札が折り返して伸びた分だけ、下側の候補を下げる（上側はそのまま）", () => {
    expect(titleTipBox(100, 80, m, { ...base, avoid: [], extra: 15 })).toMatchObject({ dy: lh / 2 + 15 });
    const below = { x0: 0, x1: 1000, y0: 80 + lh / 2 + 15, y1: 80 + lh * 1.5 + 15 };
    expect(titleTipBox(100, 80, m, { ...base, avoid: [below], extra: 15 })).toMatchObject({ dy: -lh * 1.5 });
  });
  it("右端に入らなければ左へずらして右端をそろえ、区域の外には出さない", () => {
    const box = titleTipBox(950, 10, m, { ...base, avoid: [] });
    expect(950 + box.dx + box.width).toBeLessThanOrEqual(1000);
    expect(10 + box.dy).toBeGreaterThanOrEqual(-STAGES_ROOM);
  });
});

describe("reflowExtraLines", () => {
  const m = { id: 50, status: 60, title: 200 };
  it("番号と短い説明が並ぶなら増えない", () => {
    expect(reflowExtraLines(m, 128, 12)).toBe(0);
  });
  it("並ばなければ短い説明が下の行に落ち、幅に入らなければさらに折り返す", () => {
    expect(reflowExtraLines(m, 100, 12)).toBe(1);
    expect(reflowExtraLines({ id: 50, status: 200, title: 0 }, 100, 12)).toBe(3);
  });
});

describe("reflowExtraHeight", () => {
  it("増える行が無ければ0。あれば行ぶんに、行の間の gap と番号の行の差（0.4em）を足す", () => {
    expect(reflowExtraHeight(0, 12)).toBe(0);
    expect(reflowExtraHeight(1, 12)).toBeCloseTo(12 * 1.25 + 12 * 0.4);
    expect(reflowExtraHeight(2, 12)).toBeCloseTo(12 * 2.5 + 12 * 0.4);
  });
});

describe("chooseLabel", () => {
  const m = { id: 50, status: 60, title: 200 };
  it("常に出す名札は1行（番号＋短い説明）。題名の幅は含めず、入らなければ「…」で切る", () => {
    expect(chooseLabel(m, 400, 12)).toEqual({ variant: "full", width: 128 });
    expect(chooseLabel(m, 100, 12)).toEqual({ variant: "full", width: 100 });
    expect(chooseLabel(m, 60, 12)).toEqual({ variant: "full", width: 60 });
  });

  it("幅の上限は文字の大きさの26倍", () => {
    expect(chooseLabel({ id: 50, status: 900, title: 60 }, 2000, 12).width).toBe(12 * 26);
  });
});

describe("stripColumns", () => {
  it("段階ごとにまとめ、いちばん目立つ色は 人間 → 失敗 → AI → 待機 → 公開済み の順", () => {
    const columns = stripColumns([node(1, 0, "ai"), node(2, 0, "human"), node(3, 7, "done"), node(4, 7, "fail")]);
    expect(columns).toHaveLength(8);
    expect(columns[0]).toMatchObject({ at: 0, count: 2, lead: "human" });
    expect(columns[7]).toMatchObject({ at: 7, count: 2, lead: "fail" });
    expect(columns[3]).toMatchObject({ count: 0, lead: null });
  });
});
