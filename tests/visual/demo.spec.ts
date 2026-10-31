import { expect, test, type Page } from "@playwright/test";

const REPO_PAGE = "/demo/repos/demo/todo-app";

/**
 * フォントの読み込みを待ち、画面の高さをページ全体に広げてから撮る。
 * fullPage のままだと、上に貼り付く帯（`position: sticky`）や画面いっぱいの映像（`position: fixed`）が
 * スクロール位置や最初の画面の高さの所に写って、ずれて見えるため。
 * 映像（流れ）は、動きを減らす設定（playwright.config.ts の reducedMotion）で止まり、粒の位置は種から決まるので毎回同じ
 */
async function settle(page: Page) {
  // フォントは使う文字ごとに分けて読み込まれる。読み込みが終わる前に高さを測ると、
  // 代わりのフォントの高さで決まってしまい、環境によって画像の大きさがずれる
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()?.width ?? 1440;
  let height = 0;
  let stable = 0;
  for (let i = 0; i < 20 && stable < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const next = await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.documentElement.scrollHeight;
    });
    if (next === height) {
      stable += 1;
    } else {
      stable = 0;
      height = next;
      await page.setViewportSize({ width, height });
    }
    await page.waitForTimeout(100);
  }
}

test.describe("デモの画面", () => {
  test("ホーム", async ({ page }) => {
    await page.goto("/demo");
    await settle(page);
    await expect(page).toHaveScreenshot("home.png");
  });

  test("リポジトリのページ", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await settle(page);
    await expect(page).toHaveScreenshot("repo.png");
  });

  test("マージの確認（その場で「マージする／やめる」に変わる）", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await page.getByRole("button", { name: "マージ…" }).first().click();
    await settle(page);
    await expect(page).toHaveScreenshot("repo-merge.png");
  });

  test("設定", async ({ page }) => {
    await page.goto("/demo/settings");
    await settle(page);
    await expect(page).toHaveScreenshot("settings.png");
  });

  test("メニューを開いた状態（スマホ）", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "メニューボタンはスマホだけ");
    await page.goto("/demo");
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("menu-open.png");
  });

  test("巨大な数字と「件」の間は、どの数字でも字面の右端から6px（左端も切れない）", async ({ page }) => {
    await page.goto("/demo");
    await settle(page);
    // 描いた画素（不透明なもの）の左右の端と、「件」の左端を測る
    const measure = () =>
      page.evaluate(() => {
        const box = document.querySelector<HTMLElement>("main [role=img]");
        const canvas = box?.querySelector("canvas") ?? null;
        const unit = Array.from(document.querySelectorAll<HTMLElement>("main span")).find((e) => e.textContent?.trim() === "件");
        const ctx = canvas?.getContext("2d");
        if (!box || !canvas || !unit || !ctx) return null;
        const { width, height } = canvas;
        const data = ctx.getImageData(0, 0, width, height).data;
        let min = width;
        let max = -1;
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            if (data[(y * width + x) * 4 + 3] > 128) {
              min = Math.min(min, x);
              max = Math.max(max, x);
              break;
            }
          }
        }
        const rect = canvas.getBoundingClientRect();
        const scale = width / rect.width;
        return {
          label: box.getAttribute("aria-label") ?? "",
          inkLeft: rect.left + min / scale,
          inkRight: rect.left + (max + 1) / scale,
          boxLeft: rect.left,
          unitLeft: unit.getBoundingClientRect().left,
        };
      });
    for (let guard = 0; guard < 40; guard++) {
      await page.evaluate(() => document.fonts.ready);
      // 数字の転がり（460ms）と「件」の動きが終わってから測る
      await page.waitForTimeout(900);
      const m = await measure();
      expect(m, "数字の canvas と「件」が見つかる").not.toBeNull();
      if (!m) return;
      const gap = m.unitLeft - m.inkRight;
      expect(Math.abs(gap - 6), `${m.label}：字面の右端から「件」まで ${gap.toFixed(1)}px`).toBeLessThanOrEqual(1);
      expect(m.inkLeft, `${m.label}：数字の左端が箱の左で切れていない`).toBeGreaterThanOrEqual(m.boxLeft);
      // 数を1つ減らす（確認が要る「マージ」以外のボタンを押す）
      const act = page.locator("main button[data-act]:not([aria-disabled=true])").filter({ hasNotText: "マージ" }).first();
      if ((await act.count()) === 0) break;
      await act.click();
      await page.waitForTimeout(500);
    }
  });
});

type Box = { x0: number; x1: number; y0: number; y1: number };

function overlaps(a: Box, b: Box): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
}

test.describe("動きを減らす設定×乗せた名札（流れ）", () => {
  // playwright.config.ts の reducedMotion: "reduce" で、乗せた名札の短い説明が折り返して全文が出る
  for (const target of ["landing-page#9", "todo-app#22"]) {
    test(`${target} に乗せると、折り返した全文が題名の札やほかの名札と重ならない`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "mobile", "名札の流れはPCだけ");
      await page.goto("/demo");
      await settle(page);
      const selector = `button[data-key][aria-label^="${target} "]`;
      await page.locator(selector).first().hover({ force: true });
      await page.waitForTimeout(400);
      const rects = await page.evaluate((sel) => {
        const box = (el: Element): Box => {
          const r = el.getBoundingClientRect();
          return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
        };
        const hovered = document.querySelector(sel);
        const tag = hovered?.querySelector(":scope > span");
        const l1 = tag?.querySelector(":scope > span:nth-child(1)");
        const tip = tag?.querySelector(":scope > span:nth-child(2)");
        if (!hovered || !l1 || !tip) return null;
        const others = [...document.querySelectorAll("button[data-key][data-pin]")]
          .filter((b) => b !== hovered)
          .flatMap((b) => {
            const t = b.querySelector(":scope > span");
            return t ? [box(t)] : [];
          });
        return { l1: box(l1), tip: box(tip), others };
      }, selector);
      expect(rects).not.toBeNull();
      if (!rects) return;
      expect(overlaps(rects.l1, rects.tip)).toBe(false);
      for (const other of rects.others) {
        expect(overlaps(rects.l1, other)).toBe(false);
        expect(overlaps(rects.tip, other)).toBe(false);
      }
    });
  }
});
