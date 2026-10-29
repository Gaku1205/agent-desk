import { describe, expect, it } from "vitest";
import {
  chooseVariant,
  DOT_OFFSET,
  LABEL_GAP,
  layoutFlow,
  minLaneHeight,
  stripColumns,
  type MeasureLabel,
} from "./layout";
import type { FlowNode, FlowWho } from "./nodes";

function node(number: number, at: number, who: FlowWho, title = `Issue ${number} のタイトル`): FlowNode {
  return {
    key: `o/r#${number}`,
    owner: "o",
    repo: "r",
    number,
    title,
    url: "https://example.com",
    at,
    who,
    label: "名札",
    caption: "",
    deployLinks: [],
    logUrl: null,
    turn: who === "human",
  };
}

/** 1文字 = 7px として測る（テスト用） */
const measure: MeasureLabel = (n, variant) => {
  const line1 = (`#${n.number} ` + n.label).length * 7;
  const line2 = variant === "compact" ? 0 : ((variant === "full" ? `${n.repo} ` : "") + n.title).length * 7;
  return { line1, line2 };
};

describe("layoutFlow", () => {
  it("光は段階の列に置かれ、列の左端から26px", () => {
    const layout = layoutFlow({ nodes: [node(1, 0, "ai"), node(2, 3, "ai")], width: 800, height: 400, fontSize: 12, measure });
    const [a, b] = layout.placed;
    expect(a.x).toBe(DOT_OFFSET);
    expect(b.x).toBe(3 * 100 + DOT_OFFSET);
    expect(a.flip).toBe(false);
  });

  it("右端に入らない名札は、光を右端に置いて左に出す（flip）", () => {
    const layout = layoutFlow({ nodes: [node(1, 7, "ai")], width: 800, height: 400, fontSize: 12, measure });
    const p = layout.placed[0];
    expect(p.flip).toBe(true);
    expect(p.x).toBe(800 - DOT_OFFSET);
    expect(p.x - 19 - p.width).toBeGreaterThanOrEqual(0);
  });

  it("同じ列の名札は別のレーンに置き、縦の位置が重ならない", () => {
    const nodes = [node(1, 2, "ai"), node(2, 2, "ai"), node(3, 2, "human")];
    const layout = layoutFlow({ nodes, width: 1200, height: 500, fontSize: 12, measure });
    const ys = layout.placed.map((p) => p.y).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(3);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(minLaneHeight(12) * 0.85 - 0.01);
  });

  it("列の中の光は、流れの高さの真ん中に寄せる（左上に片寄らない）", () => {
    const layout = layoutFlow({ nodes: [node(1, 0, "ai")], width: 1200, height: 500, fontSize: 12, measure });
    expect(Math.abs(layout.placed[0].y - 250)).toBeLessThan(1);
  });

  it("名札が横に重なる物は、隣の列でも別のレーンになる", () => {
    const long = "とても長いタイトルがずっと続いていて隣の列まで伸びる";
    const nodes = [node(1, 0, "ai", long), node(2, 1, "ai", long)];
    const layout = layoutFlow({ nodes, width: 800, height: 500, fontSize: 12, measure });
    const [a, b] = layout.placed;
    const aRight = a.x + LABEL_GAP + a.width;
    if (aRight > b.x - 12) expect(a.lane).not.toBe(b.lane);
  });

  it("公開済みは1行の名札（compact）", () => {
    const { variant } = chooseVariant(node(9, 7, "done"), 300, measure);
    expect(variant).toBe("compact");
  });

  it("名札が入らない幅では、リポジトリ名を省き、それでも入らなければ切る", () => {
    const n = node(1, 0, "ai", "長めのタイトルです");
    // full: "r 長めのタイトルです" = 11文字 = 77px + 12、noRepo: 9文字 = 63px + 12
    expect(chooseVariant(n, 300, measure).variant).toBe("full");
    expect(chooseVariant(n, 80, measure)).toEqual({ variant: "noRepo", width: 75 });
    expect(chooseVariant(n, 60, measure)).toEqual({ variant: "noRepo", width: 60 });
  });

  it("高さに入らないほど多いときだけ、公開済みを1つにまとめる", () => {
    const many = Array.from({ length: 30 }, (_, i) => node(i + 1, 7, "done"));
    const tall = layoutFlow({ nodes: many, width: 1200, height: 2000, fontSize: 12, measure });
    expect(tall.cluster).toBeNull();
    const short = layoutFlow({ nodes: many, width: 1200, height: 120, fontSize: 12, measure });
    expect(short.cluster?.count).toBe(30);
    expect(short.placed.map((p) => p.key)).toEqual(["cluster:deployed"]);
  });

  it("0件でも壊れない", () => {
    const layout = layoutFlow({ nodes: [], width: 800, height: 300, fontSize: 12, measure });
    expect(layout.placed).toEqual([]);
    expect(layout.cluster).toBeNull();
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

describe("公開済みの積み方", () => {
  it("公開済みは右端に1行の名札で縦に積み、ほかの名札がかかる所は飛ばす", () => {
    const nodes = [node(1, 6, "ai", "とても長いタイトルがずっと続いていて右端まで伸びる物"), node(2, 7, "done"), node(3, 7, "done"), node(4, 7, "done")];
    const layout = layoutFlow({ nodes, width: 1200, height: 400, fontSize: 12, measure });
    expect(layout.cluster).toBeNull();
    const dones = layout.placed.filter((p) => p.variant === "compact");
    expect(dones).toHaveLength(3);
    expect(dones.every((p) => p.flip && p.x === 1200 - DOT_OFFSET)).toBe(true);
    const ys = dones.map((p) => p.y);
    expect(ys[1] - ys[0]).toBeGreaterThan(0);
    expect(ys[2] - ys[1]).toBeGreaterThan(0);
  });

  it("縦の位置が小数でも止まらない", () => {
    const nodes = [node(1, 7, "ai", "x"), node(2, 7, "done"), node(3, 7, "done"), node(4, 7, "done")];
    const layout = layoutFlow({ nodes, width: 1376.64, height: 357.3, fontSize: 12.5, measure });
    expect(layout.placed.length).toBe(4);
  });
});
