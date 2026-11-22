import { expect, test } from "@playwright/test";

// Slots & Queue の Your turn の説明が、折り返して全文出ること（Issue #768）。
// 基準の画像は使わない。幅390・1024・1440 の `/demo/lanes` で、各行の説明が切れず、行の中身どうしが重ならないことを測る
for (const width of [390, 1024, 1440]) {
  test(`Your turn の説明は切れずに全文出る（幅${width}）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demo/lanes");
    const rows = page.locator('[data-kind="turn"]');
    await expect(rows.first()).toBeVisible();

    const result = await rows.evaluateAll((els) => {
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      return els.map((row) => {
        const desc = row.querySelector<HTMLElement>("[class*='turnDesc']");
        const parts = ["[class*='left']", "[class*='middle']", "[class*='turnRight']"]
          .map((s) => row.querySelector<HTMLElement>(s))
          .filter((e): e is HTMLElement => e !== null)
          .map((e) => e.getBoundingClientRect());
        let overlapped = false;
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            if (overlap(parts[i], parts[j])) overlapped = true;
          }
        }
        return {
          cut: desc ? desc.scrollWidth > desc.clientWidth : false,
          ellipsis: desc ? getComputedStyle(desc).textOverflow === "ellipsis" : false,
          overlapped,
          height: row.getBoundingClientRect().height,
        };
      });
    });

    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.cut, "説明が切れていない").toBe(false);
      expect(r.ellipsis, "text-overflow: ellipsis が効いていない").toBe(false);
      expect(r.overlapped, "行の中身どうしが重ならない").toBe(false);
      expect(r.height).toBeGreaterThanOrEqual(56 - 0.01);
    }
  });
}
