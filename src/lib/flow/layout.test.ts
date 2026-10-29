import { describe, expect, it } from "vitest";
import {
  COLUMN_END_MARGIN,
  chooseLabel,
  DOT_OFFSET,
  LABEL_GAP,
  labelHeight,
  layoutFlow,
  stripColumns,
  type FlowLayout,
  type MeasureLabel,
  type PlacedNode,
} from "./layout";
import type { FlowNode, FlowWho } from "./nodes";

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
    deployLinks: [],
    logUrl: null,
    turn: who === "human",
  };
}

/** 1文字 = 文字の大きさ×0.9 として測る（テスト用）。番号はリポジトリ名つき */
function measureAt(fontSize: number): MeasureLabel {
  const w = (text: string) => text.length * fontSize * 0.9;
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

/** 1440×900・1024×768・2560×1440 の流れ（幅は左右の余白を除く、高さは光の区域） */
const SIZES = [
  { name: "1024", width: 984, height: 144, fontSize: 11.55, overhang: 20 },
  { name: "1280", width: 1224, height: 152, fontSize: 12.14, overhang: 28 },
  { name: "1440", width: 1376, height: 178, fontSize: 12.5, overhang: 32 },
  { name: "2560", width: 2480, height: 184, fontSize: 15, overhang: 40 },
];

/** 光の区域の上の、段階の目盛り（乗せたときの名札はここまでかかってよい） */
const STAGES_ROOM = 30;

function run(size: (typeof SIZES)[number], nodes = demoLike()): FlowLayout {
  return layoutFlow({ nodes, ...size, measure: measureAt(size.fontSize) });
}

function labelRect(p: PlacedNode, fontSize: number) {
  return { x0: p.x + p.dx, x1: p.x + p.dx + p.width, y0: p.y + p.dy, y1: p.y + p.dy + labelHeight(fontSize) };
}

describe("layoutFlow", () => {
  for (const size of SIZES) {
    describe(`幅 ${size.name}`, () => {
      const layout = run(size);
      const nodes = demoLike();
      const byKey = new Map(nodes.map((n) => [n.key, n]));

      it("全部の光を出し、光は必ず自分の段階の列の中にある", () => {
        expect(layout.placed).toHaveLength(nodes.length);
        expect(layout.hidden).toEqual([]);
        for (const p of layout.placed) {
          const at = byKey.get(p.key)?.at ?? -1;
          expect(p.column).toBe(at);
          expect(p.x).toBeGreaterThanOrEqual(at * layout.columnWidth + DOT_OFFSET - 0.01);
          expect(p.x).toBeLessThanOrEqual((at + 1) * layout.columnWidth - COLUMN_END_MARGIN + 0.01);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(size.height);
        }
      });

      it("常に名札を出すのは、人間の番と失敗だけ", () => {
        const pinned = layout.placed.filter((p) => p.pinned).map((p) => byKey.get(p.key)?.who);
        expect(pinned).toHaveLength(9);
        expect(pinned.every((who) => who === "human" || who === "fail")).toBe(true);
      });

      it("常に出す名札は光の右（反転しない）で、右端からはみ出さず、ほかの名札と重ならない", () => {
        const pinned = layout.placed.filter((p) => p.pinned);
        for (const p of pinned) {
          expect(p.dx).toBe(LABEL_GAP);
          expect(p.x + p.dx + p.width).toBeLessThanOrEqual(size.width + size.overhang);
          expect(p.width).toBeGreaterThan(size.fontSize * 5);
        }
        for (const a of pinned) {
          for (const b of pinned) {
            if (a === b) continue;
            const ra = labelRect(a, size.fontSize);
            const rb = labelRect(b, size.fontSize);
            const overlap = ra.x0 < rb.x1 && rb.x0 < ra.x1 && ra.y0 < rb.y1 && rb.y0 < ra.y1;
            expect(overlap, `${a.key} と ${b.key}`).toBe(false);
          }
        }
      });

      it("名札を出さない光は、名札の範囲とほかの光に重ならない", () => {
        const pinned = layout.placed.filter((p) => p.pinned);
        const dots = layout.placed.filter((p) => !p.pinned);
        for (const d of dots) {
          for (const p of pinned) {
            const r = labelRect(p, size.fontSize);
            const inside = d.x >= r.x0 - 10 && d.x <= r.x1 && d.y >= r.y0 && d.y <= r.y1;
            expect(inside, `${d.key} が ${p.key} の名札の上`).toBe(false);
          }
          for (const e of dots) {
            if (d === e) continue;
            expect(Math.hypot(d.x - e.x, d.y - e.y), `${d.key} と ${e.key}`).toBeGreaterThan(9);
          }
        }
      });

      it("乗せたときの名札も右端からはみ出さず、光の右か、光の下・上に出る（左右の反転はしない）", () => {
        for (const p of layout.placed.filter((q) => !q.pinned)) {
          expect(p.x + p.dx + p.width).toBeLessThanOrEqual(size.width + size.overhang + 0.01);
          expect(p.x + p.dx).toBeGreaterThanOrEqual(-0.01);
          if (p.dx !== LABEL_GAP) {
            // ずらしたときは光と重ならない高さ
            const r = labelRect(p, size.fontSize);
            expect(r.y0 > p.y || r.y1 < p.y).toBe(true);
            // 下端の行（説明と凡例）にかからない
            expect(r.y1).toBeLessThanOrEqual(size.height + 0.01);
            expect(r.y0).toBeGreaterThanOrEqual(-STAGES_ROOM);
          }
        }
      });
    });
  }

  it("同じ列の常に出す名札は別のレーンで、区域の真ん中に寄せる", () => {
    const nodes = [node(1, 2, "human"), node(2, 2, "human")];
    const layout = layoutFlow({ nodes, width: 1200, height: 160, fontSize: 12, overhang: 30, measure: measureAt(12) });
    const [a, b] = layout.placed;
    expect(a.lane).not.toBe(b.lane);
    expect(Math.abs((a.y + b.y) / 2 - 80)).toBeLessThan(1);
  });

  it("左の列の名札がかかっているレーンは避ける", () => {
    const long = "とても長いタイトルがずっと続いていて隣の列まで伸びる";
    const nodes = [node(1, 0, "human", { title: long }), node(2, 1, "human", { title: long })];
    const layout = layoutFlow({ nodes, width: 800, height: 160, fontSize: 12, overhang: 20, measure: measureAt(12) });
    const [a, b] = layout.placed;
    expect(a.lane).not.toBe(b.lane);
  });

  it("レーンより多い人間の番は、入らない物だけ名札を出さない光にする", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node(i + 1, 0, "human"));
    const layout = layoutFlow({ nodes, width: 1200, height: 160, fontSize: 12, overhang: 30, measure: measureAt(12) });
    expect(layout.lanes).toBe(4);
    // 4つのレーンを全部使うと残りの光が入らないので、3つにする
    expect(layout.placed.filter((p) => p.pinned)).toHaveLength(3);
    expect(layout.placed).toHaveLength(6);
    expect(layout.hidden).toEqual([]);
  });

  it("名札のレーンで列がふさがり光が入らないときは、その列の常に出す名札を減らす（光は全部出す）", () => {
    const nodes = Array.from({ length: 7 }, (_, i) => node(i + 1, 0, "human"));
    const layout = layoutFlow({ nodes, width: 1200, height: 120, fontSize: 12, overhang: 30, measure: measureAt(12) });
    expect(layout.lanes).toBe(3);
    expect(layout.hidden).toEqual([]);
    expect(layout.placed).toHaveLength(7);
    expect(layout.placed.filter((p) => p.pinned).length).toBeGreaterThanOrEqual(1);
    expect(layout.placed.filter((p) => p.pinned).length).toBeLessThan(3);
  });

  it("右の列の常に出す名札は、入らなければ縦に積む出し方にする", () => {
    const n = node(9, 7, "fail", { repo: "landing-page", label: "公開に失敗しました" });
    const layout = layoutFlow({ nodes: [n], width: 984, height: 144, fontSize: 11.55, overhang: 20, measure: measureAt(11.55) });
    expect(layout.placed[0]).toMatchObject({ pinned: true, variant: "stack", dx: LABEL_GAP });
  });

  it("名札を出さない光が列に入らないときは格子を詰め、それでも入らない物は出さない", () => {
    const many = Array.from({ length: 40 }, (_, i) => node(i + 1, 7, "done"));
    const roomy = layoutFlow({ nodes: many, width: 1376, height: 178, fontSize: 12.5, overhang: 30, measure: measureAt(12.5) });
    expect(roomy.hidden).toEqual([]);
    const cramped = layoutFlow({ nodes: many, width: 600, height: 40, fontSize: 12.5, overhang: 30, measure: measureAt(12.5) });
    expect(cramped.hidden.length).toBeGreaterThan(0);
    expect(cramped.placed.length + cramped.hidden.length).toBe(40);
  });

  it("0件でも壊れない", () => {
    const layout = layoutFlow({ nodes: [], width: 800, height: 150, fontSize: 12, overhang: 20, measure: measureAt(12) });
    expect(layout.placed).toEqual([]);
    expect(layout.hidden).toEqual([]);
  });
});

describe("chooseLabel", () => {
  const m = { id: 50, status: 60, title: 200 };
  it("1行目が入れば2行（題名は切る）、入らなければ縦に積む", () => {
    expect(chooseLabel(m, 400, 12)).toEqual({ variant: "full", width: 212 });
    expect(chooseLabel(m, 150, 12)).toEqual({ variant: "full", width: 150 });
    expect(chooseLabel(m, 100, 12)).toEqual({ variant: "stack", width: 72 });
    expect(chooseLabel(m, 60, 12)).toEqual({ variant: "stack", width: 60 });
  });

  it("幅の上限は文字の大きさの26倍", () => {
    expect(chooseLabel({ id: 50, status: 60, title: 900 }, 2000, 12).width).toBe(12 * 26);
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
