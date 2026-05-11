import { expect, test } from "@playwright/test";

test("loads the mock decoder example", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Aurora Lens" })).toBeVisible();
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(page.getByText("example.raster: page 1 of 2")).toBeVisible();

  const image = page.locator('img[alt="example.raster page 1"]').first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Search Aurora" }).click();
  await expect(page.getByRole("button", { name: "Thumbnails" })).toBeEnabled();
});
