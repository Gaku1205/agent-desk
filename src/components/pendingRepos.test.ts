import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Lanes } from "./Lanes";
import { StaleNote } from "./StaleNote";

// 部品の描画だけを見る（ログインの仕組みは読み込まない）
vi.mock("@/lib/auth", () => ({}));

// まだ届いていないリポジトリがある段の出し方（docs/spec.md の「全部のリポジトリを待つページ」）

describe("下の帯", () => {
  it("届いていないリポジトリがある間は、時刻ではなく件数を言う", () => {
    const html = renderToStaticMarkup(
      createElement(StaleNote, { staleAt: "2026-11-21T10:11:00Z", staleBecause: "loading", complete: false, pendingRepos: 2 }),
    );
    expect(html).toContain("2件のリポジトリを読んでいます…");
    expect(html).not.toContain("時点の内容です");
  });

  it("全部そろった（覚えている結果を含む）段では、今の時刻の文に戻る", () => {
    const html = renderToStaticMarkup(
      createElement(StaleNote, { staleAt: "2026-11-21T10:11:00Z", staleBecause: "loading", complete: false, pendingRepos: 0 }),
    );
    expect(html).toContain("時点の内容です。新しい内容を読んでいます…");
    expect(html).not.toContain("件のリポジトリ");
  });
});

describe("Slots & Queue（pending）", () => {
  const props: ComponentProps<typeof Lanes> = {
    source: { works: [], queue: [], runs: [], paused: [] },
    usage: null,
    items: [],
    now: "2026-11-21T10:11:00Z",
    nav: { repos: [], counts: {} } as unknown as ComponentProps<typeof Lanes>["nav"],
    readMode: "pending",
  };

  it("「ありません」の文を見せず、数は 0 ではなく – にする", () => {
    const html = renderToStaticMarkup(createElement(Lanes, props));
    // 空の文は、場所だけ取って読み上げ・見えには出さない（aria-hidden）
    for (const text of ["あなたが答えることはありません", "順番待ちの作業はありません", "いまは CI や公開の作業はありません"]) {
      const index = html.indexOf(text);
      if (index >= 0) expect(html.slice(Math.max(0, index - 120), index)).toContain('aria-hidden="true"');
    }
    expect(html).not.toContain("Free ×");
    expect(html).toContain("–");
  });

  it("全部届いた段（ok）では今までどおり空の文を出す", () => {
    const html = renderToStaticMarkup(createElement(Lanes, { ...props, readMode: "ok" }));
    expect(html).toContain("順番待ちの作業はありません");
    expect(html).not.toContain("–");
  });
});
