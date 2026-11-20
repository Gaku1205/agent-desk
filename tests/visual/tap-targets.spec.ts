import { expect, test, type Locator, type Page } from "@playwright/test";

// スマホ（390×844）で、押せる物の押せる範囲が高さ44px以上あることを確かめる（Issue #616。#623 が同じテストに部品を足す）。
// 基準の画像は使わない。要素の矩形に、疑似要素で広げた分を足した範囲の上端・真ん中・下端を `elementFromPoint` で押して、
// その要素（またはその中身）に当たるかを見る。となりの押せる物と重なっていれば、別の物に当たって失敗する
test.skip(({ isMobile }) => !isMobile, "スマホの大きさでだけ動かす");

const MIN = 44;

/**
 * 押せる範囲が高さ44px以上か。`up`・`down` は、見た目の外へ広げた量（省略すると、足りない分を上下に半分ずつ）。
 * 帯のますのように縦だけ見る物は、横は中心の1点だけで見る
 */
async function expectTall(locator: Locator, spread?: { up: number; down: number }) {
  await expect(locator.first()).toBeVisible();
  await locator.first().evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  const result = await locator.first().evaluate(
    (el, given) => {
      const rect = el.getBoundingClientRect();
      const lack = Math.max(0, 44 - rect.height);
      const up = given ? given.up : lack / 2;
      const down = given ? given.down : lack / 2;
      const x = rect.left + rect.width / 2;
      const top = rect.top - up;
      const bottom = rect.bottom + down;
      // 端から1px内側を押す（となりの押せる物とぴったり接していても、小数の誤差で別の物に当たらないように）
      const hits = [top + 1, (top + bottom) / 2, bottom - 1].map((y) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && el.contains(hit);
      });
      return { height: bottom - top, hits };
    },
    spread ?? null,
  );
  expect(result.height, "押せる範囲の高さ").toBeGreaterThanOrEqual(MIN - 0.01);
  expect(result.hits, "上端・真ん中・下端がその要素に当たる").toEqual([true, true, true]);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
}

test("Dashboard：期間・Slots & Queue を見る・Merged のリポジトリ名", async ({ page }) => {
  await page.goto("/demo/dashboard");
  for (const name of ["24h", "7d", "30d"]) {
    await expectTall(page.getByRole("tab", { name, exact: true }));
  }
  await expectTall(page.getByRole("link", { name: /Slots & Queue を見る/ }));
  await expectTall(page.locator('section[aria-labelledby="throughput-heading"] ul a').first());
  await expectNoOverflow(page);
});

test("設定：外す・追加・スイッチ・Parallel・通知・Theme と Motion・目次", async ({ page }) => {
  await page.goto("/demo/settings");
  await expectTall(page.getByRole("button", { name: /を外す$/ }));
  await expectTall(page.getByRole("button", { name: "追加", exact: true }));
  const switches = page.getByRole("switch");
  for (let i = 0; i < (await switches.count()); i++) await expectTall(switches.nth(i));
  await expectTall(page.getByRole("button", { name: "昼の数を減らす" }));
  await expectTall(page.getByRole("button", { name: "昼の数を増やす" }));
  // 帯のます：縦だけ（上2px・下16pxに広げる）
  await expectTall(page.getByRole("button", { name: "0時", exact: true }), { up: 2, down: 16 });
  await expectTall(page.getByRole("button", { name: "12時", exact: true }), { up: 2, down: 16 });
  await expectTall(page.getByRole("combobox", { name: "夜の始まり" }));
  await expectTall(page.getByRole("button", { name: /のリポジトリ（/ }));
  for (const label of ["テーマ", "アニメーション"]) {
    const radios = page.getByRole("radiogroup", { name: label }).getByRole("radio");
    for (let i = 0; i < (await radios.count()); i++) await expectTall(radios.nth(i));
  }
  const toc = page.getByRole("navigation", { name: "設定の目次" }).getByRole("link");
  for (let i = 0; i < (await toc.count()); i++) await expectTall(toc.nth(i));
  await expectNoOverflow(page);
});

test("すべてのリポジトリ：Setup・GitHub ↗・開く ↗", async ({ page }) => {
  await page.goto("/demo/repos");
  await expectTall(page.getByRole("link", { name: /Setup/ }).first());
  await expectTall(page.getByRole("link", { name: /^GitHub ↗/ }));
  await expectTall(page.getByRole("link", { name: /^開く ↗/ }));
  await expectNoOverflow(page);
});

test("/setup：Public・Private・作る・作ってあるリポジトリを使う", async ({ page }) => {
  await page.goto("/demo/setup");
  await expectTall(page.getByRole("radio", { name: "Public" }));
  await expectTall(page.getByRole("radio", { name: "Private" }));
  await expectTall(page.getByRole("button", { name: "作る", exact: true }));
  await expectTall(page.getByRole("button", { name: "作ってあるリポジトリを使う" }));
  await expectNoOverflow(page);
});

test("Issueを書く・新しいサービスを作る：作るボタン", async ({ page }) => {
  await page.goto("/demo/new");
  await expectTall(page.getByRole("button", { name: "Issueを作る", exact: true }));
  await expectNoOverflow(page);
  await page.goto("/demo/new/service");
  await expectTall(page.getByRole("button", { name: "サービスを作る", exact: true }));
  await expectNoOverflow(page);
});

test("ホーム：Your turn の列の行", async ({ page }) => {
  // ホームは待ちが1件以上の間、入力欄を出さない
  await page.goto("/demo");
  await expectTall(page.locator('aside[aria-label="Your turn の全部"] button').first());
  await expectNoOverflow(page);
});

test("リポジトリのページ：入力欄の下の行", async ({ page }) => {
  await page.goto("/demo/repos/demo/todo-app");
  const bar = page.getByRole("region", { name: "Issueを書く" });
  await expectTall(bar.getByRole("link", { name: /新しいサービス/ }));
  await expectTall(bar.getByRole("button", { name: "画像を付ける" }));
  await expectTall(bar.locator("button[aria-haspopup]").first());
  await expectNoOverflow(page);
});

test("上のバー（デモ）：再生・同時に動かす", async ({ page }) => {
  await page.goto("/demo");
  await expectTall(page.getByRole("button", { name: /^再生/ }), { up: 7, down: 7 });
  await expectTall(page.locator("button[aria-expanded]").filter({ hasText: /\d\/\d/ }), { up: 8, down: 8 });
  await expectNoOverflow(page);
});

test("Slots & Queue：題名・ログ ↗・待ち：のリンク", async ({ page }) => {
  await page.goto("/demo/lanes");
  const slot = page.locator('li[data-kind="slot"], [data-kind="slot"]').first();
  await expectTall(slot.getByRole("link").first());
  await expectTall(page.getByRole("link", { name: /^ログ ↗/ }).first());
  await expectTall(page.locator('[data-kind="next"], [data-tone="running"]').getByRole("link").first());
  await expectNoOverflow(page);
});

test("メニューの中：同時に動かすの3択", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "メニュー", exact: true }).tap();
  const radios = page.getByRole("dialog", { name: "メニュー" }).getByRole("radiogroup", { name: "同時に動かす数" }).getByRole("radio");
  expect(await radios.count()).toBe(3);
  for (let i = 0; i < 3; i++) await expectTall(radios.nth(i));
});
