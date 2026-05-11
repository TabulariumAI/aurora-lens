import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import {
  ACTIVE_VIEWER_SESSION_ID,
  VIEWER_SESSION_DB_NAME,
  VIEWER_SESSION_DB_VERSION,
  VIEWER_SESSION_STORE_NAME,
} from "../../src/app/viewerSessionDb";
import { VIEWER_SAMPLES } from "../../src/samples";

test("loads a TIFF through Tabularium AI Lens and exercises host controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tabularium AI Lens" })).toBeVisible();
  await expect(page.getByLabel("TIFF loader")).toBeVisible();
  await expect(page.getByLabel("Page details")).toBeVisible();

  const fixture = path.resolve("tests/fixtures/sample-multipage.tiff");
  await page.getByLabel("Load TIFF").setInputFiles(fixture);
  await expect(page.getByText(/Decoding TIFF page|Loading page/)).toBeVisible();

  const details = page.getByLabel("Page details");
  await expect(details.getByText("sample-multipage.tiff")).toBeVisible();
  await expect(details.getByText("1 of 2")).toBeVisible();
  await expect(details.getByText("2540 x 3312")).toBeVisible();
  await expect.poll(() => page.locator(".viewer-body").evaluate((element) => getComputedStyle(element).overflow)).toBe("auto");
  await expect.poll(() => page.locator(".viewer-body").evaluate((element) => getComputedStyle(element).paddingTop)).toBe("4px");
  await expect.poll(() => page.locator(".viewer-toolbar").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(248, 251, 252)");
  await expect(page.getByLabel("Intelligence ready", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search" })).toBeDisabled();
  await expect.poll(() => page.locator(".viewer-footer").evaluate((element) => getComputedStyle(element).borderTopColor)).toBe("rgb(214, 220, 226)");
  await expect
    .poll(() => page.getByRole("button", { name: "All thumbnails" }).evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(255, 255, 255)");

  const pageImage = page.locator('.viewer-body img[alt="sample-multipage.tiff page 1"]').first();
  await expect(pageImage).toBeVisible();
  await expect.poll(() => pageImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const imageBox = await pageImage.boundingBox();
  const canvasBox = await page.locator(".viewer-body canvas").boundingBox();
  expect(imageBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  await expect.poll(() => pageImage.evaluate((image) => getComputedStyle(image).imageRendering)).toBe("auto");
  await expect
    .poll(() =>
      pageImage.evaluate((image) => {
        const element = image as HTMLImageElement;
        const rect = element.getBoundingClientRect();
        return Math.abs(rect.width / rect.height - element.naturalWidth / element.naturalHeight);
      })
    )
    .toBeLessThan(0.001);
  await expect(details.getByRole("heading", { name: "Document" })).toBeVisible();
  await expect(details.getByRole("heading", { name: "Selection" })).toBeVisible();
  await expect(details.getByRole("heading", { name: "Style" })).toBeVisible();
  await expect(details.getByLabel("Context fill rgba(255, 230, 128, 0.25)")).toBeVisible();
  await expect(details.getByLabel("High >=95% border #005168")).toBeVisible();
  await expect(details.locator(".theme-swatch")).toHaveCount(10);
  await expect.poll(() => details.locator(".theme-head").first().evaluate((element) => getComputedStyle(element).fontSize)).toBe("12px");
  await expect(details.getByText(/undefined/)).toHaveCount(0);

  const rem = await page.evaluate(() => Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize));
  const pad = rem * 0.35;
  const builders = canvasPoint(imageBox!, canvasBox!, 2540, 3312, 238, 435, pad);
  const date = canvasPoint(imageBox!, canvasBox!, 2540, 3312, 635, 689, pad);
  const buildersCenter = screenPoint(imageBox!, 2540, 3312, 360.5, 459.5);
  await page.mouse.dblclick(buildersCenter.x, buildersCenter.y);
  await expect(page.getByRole("button", { name: "Copy selected words" })).toBeDisabled();
  await expect.poll(() => maxAlpha(page, builders)).toBe(0);
  await expect.poll(() => maxAlpha(page, date)).toBe(0);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(details.getByText("2 of 2")).toBeVisible();

  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByRole("button", { name: /page 1/i })).toBeVisible();
  await expect(page.getByLabel("Intelligence ready for page 1")).toHaveCount(0);
  await expect(page.getByLabel("Intelligence ready for page 2")).toHaveCount(0);
  await expect
    .poll(() => page.getByRole("button", { name: /page 1/i }).evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  await expect
    .poll(() => page.getByRole("button", { name: /page 1/i }).evaluate((element) => getComputedStyle(element.parentElement!).borderTopWidth))
    .toBe("0px");
  await expect
    .poll(() => page.locator(".viewer-body > div").first().evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  const thumbnailGrid = page.locator(".viewer-body > div > div").nth(1);
  await expect.poll(() => thumbnailGrid.evaluate((element) => getComputedStyle(element).overflow)).toBe("auto");
  await expect.poll(() => thumbnailGrid.evaluate((element) => getComputedStyle(element).height)).not.toBe("520px");
  await expect
    .poll(() => page.getByRole("button", { name: /page 1/i }).evaluate((element) => getComputedStyle(element.parentElement!).boxShadow))
    .toBe("none");
  const thumbnailBox = await page.getByRole("button", { name: /page 1/i }).boundingBox();
  expect(thumbnailBox).not.toBeNull();
  const thumbnailImage = page.locator('button img[alt="sample-multipage.tiff page 1"]').first();
  await expect
    .poll(() =>
      thumbnailImage.evaluate((image) => {
        const element = image as HTMLImageElement;
        const rect = element.getBoundingClientRect();
        return element.naturalWidth >= rect.width && element.naturalHeight >= rect.height;
      })
    )
    .toBe(true);
  expect(thumbnailBox!.width).toBeLessThanOrEqual(355);
  expect(thumbnailBox!.height).toBeGreaterThanOrEqual(460);
  expect(thumbnailBox!.height).toBeLessThanOrEqual(505);
  await page.getByRole("button", { name: /page 1/i }).click();
  await expect(details.getByText("1 of 2")).toBeVisible();
  const reopenedImage = page.locator('.viewer-body img[alt="sample-multipage.tiff page 1"]').first();
  await expect(reopenedImage).toBeVisible();
  await expect.poll(() => reopenedImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const reopenedBox = await reopenedImage.boundingBox();
  expect(reopenedBox).not.toBeNull();
  expect(reopenedBox!.width).toBeGreaterThan(100);
  expect(reopenedBox!.height).toBeGreaterThan(100);

  await expect(page.getByRole("button", { name: "Search" })).toBeDisabled();
});

test("scrolls thumbnail grid when thumbnail cards exceed the visible area", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");

  const fixture = path.resolve("tests/fixtures/sample-multipage.tiff");
  await page.getByLabel("Load TIFF").setInputFiles(fixture);
  await expect(page.getByRole("button", { name: "All thumbnails" })).toBeEnabled();
  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByRole("button", { name: /page 2/i })).toBeVisible();

  const thumbnailGrid = page.locator(".viewer-body > div > div").nth(1);
  await thumbnailGrid.evaluate((element) => {
    const cards = Array.from(element.children);
    for (let index = 0; index < 6; index += 1) {
      const card = cards[index % cards.length]?.cloneNode(true);
      if (card) {
        element.appendChild(card);
      }
    }
  });
  await expect.poll(() => thumbnailGrid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await thumbnailGrid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => thumbnailGrid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("loads every bundled sample TIFF", async ({ page }) => {
  await page.goto("/");

  const expected = new Map([
    ["sample-1", { pages: "1 of 2", size: "2540 x 3312" }],
    ["sample-2", { pages: "1 of 5", size: "2550 x 3300" }],
    ["sample-3", { pages: "1 of 3", size: "2550 x 3300" }],
  ]);

  for (const sample of VIEWER_SAMPLES) {
    const expectation = expected.get(sample.label);
    if (!expectation) {
      throw new Error(`Missing browser sample expectation for ${sample.label}.`);
    }
    await page.getByRole("button", { name: sample.label }).click();
    const pageImage = page.locator('.viewer-body img[alt="sample.tiff page 1"]').first();
    await expect(pageImage).toBeVisible();
    await expect.poll(() => pageImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const details = page.getByLabel("Page details");
    await expect(details.getByText("sample.tiff")).toBeVisible();
    await expect(details.getByText(expectation.pages)).toBeVisible();
    await expect(details.getByText(expectation.size)).toBeVisible();
  }
});

test("clears sample metadata when a user-selected TIFF is loaded", async ({ page }) => {
  await page.route("**/samples/sample-1/sample.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        pages: [
          {
            pageNumber: 1,
            width: 2540,
            height: 3312,
            unit: "pixel",
            tokens: [{ content: "LOAN", confidence: 0.99, polygon: [150, 150, 350, 150, 350, 230, 150, 230] }],
            contexts: [{ content: "LOAN sample context", role: "body", polygon: [120, 120, 720, 120, 720, 280, 120, 280] }],
            figures: [],
          },
        ],
      }),
    });
  });

  await page.goto("/");

  await page.getByRole("button", { name: "sample-1" }).click();
  await expect(page.locator('.viewer-body img[alt="sample.tiff page 1"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeEnabled();
  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByLabel("Intelligence ready for page 1")).toBeVisible();

  const fixture = path.resolve("tests/fixtures/sample-multipage.tiff");
  await page.getByLabel("Load TIFF").setInputFiles(fixture);
  await expect(page.locator('.viewer-body img[alt="sample-multipage.tiff page 1"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeDisabled();

  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByRole("button", { name: /page 1/i })).toBeVisible();
  await expect(page.getByLabel(/Intelligence ready for page/)).toHaveCount(0);
});

test("restores a metadata-backed shortcut source after refresh", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "sample-1" }).click();
  const details = page.getByLabel("Page details");
  await expect(details.getByText("1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(details.getByText("2 of 2")).toBeVisible();
  await expect.poll(() => storedPageIndex(page)).toBe(1);

  await page.reload();

  await expect(details.getByText("sample.tiff")).toBeVisible();
  await expect(details.getByText("2 of 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeEnabled();
  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByLabel("Intelligence ready for page 2")).toBeVisible();
});

test("restores a no-intelligence TIFF source after refresh", async ({ page }) => {
  await page.goto("/");

  const fixture = path.resolve("tests/fixtures/sample-multipage.tiff");
  await page.getByLabel("Load TIFF").setInputFiles(fixture);
  const details = page.getByLabel("Page details");
  await expect(details.getByText("1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(details.getByText("2 of 2")).toBeVisible();
  await expect.poll(() => storedPageIndex(page)).toBe(1);

  await page.reload();

  await expect(details.getByText("sample-multipage.tiff")).toBeVisible();
  await expect(details.getByText("2 of 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeDisabled();
});

test("ignores corrupt persisted viewer sessions", async ({ page }) => {
  await page.goto("/");
  await seedCorruptSession(page);

  await page.reload();

  await expect(page.getByText("Could not restore the previous viewer session.")).toBeVisible();
  const details = page.getByLabel("Page details");
  await expect(details.getByText("None").first()).toBeVisible();
  await expect(page.getByText("Choose, drop, or select a sample TIFF file.")).toBeVisible();
});

function canvasPoint(
  image: { x: number; y: number; width: number; height: number },
  canvas: { x: number; y: number },
  pageWidth: number,
  pageHeight: number,
  x: number,
  y: number,
  pad: number
) {
  return {
    x: image.x + (x / pageWidth) * image.width - canvas.x - pad,
    y: image.y + (y / pageHeight) * image.height - canvas.y - pad,
  };
}

function screenPoint(
  image: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
  x: number,
  y: number
) {
  return {
    x: image.x + (x / pageWidth) * image.width,
    y: image.y + (y / pageHeight) * image.height,
  };
}

async function maxAlpha(page: Page, point: { x: number; y: number }) {
  return page.locator(".viewer-body canvas").evaluate((canvas, point) => {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }
    const ratio = window.devicePixelRatio || 1;
    const x = Math.round(point.x * ratio) - 3;
    const y = Math.round(point.y * ratio) - 3;
    const size = Math.round(8 * ratio);
    const data = context.getImageData(x, y, size, size).data;
    let alpha = 0;
    for (let index = 3; index < data.length; index += 4) {
      alpha = Math.max(alpha, data[index]);
    }
    return alpha;
  }, point);
}

async function storedPageIndex(page: Page) {
  return page.evaluate(async ({ databaseName, databaseVersion, storeName, sessionId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number | null>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(sessionId);
        request.onsuccess = () => {
          const session = request.result as { pageIndex?: unknown } | undefined;
          resolve(typeof session?.pageIndex === "number" ? session.pageIndex : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, viewerSessionDbContext());
}

async function seedCorruptSession(page: Page) {
  await page.evaluate(async ({ databaseName, databaseVersion, storeName, sessionId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore(storeName).put({
          id: sessionId,
          fileName: "corrupt.tiff",
          fileType: "image/tiff",
          metadata: null,
          pageIndex: 0,
          updatedAt: Date.now(),
        });
      });
    } finally {
      database.close();
    }
  }, viewerSessionDbContext());
}

function viewerSessionDbContext() {
  return {
    databaseName: VIEWER_SESSION_DB_NAME,
    databaseVersion: VIEWER_SESSION_DB_VERSION,
    storeName: VIEWER_SESSION_STORE_NAME,
    sessionId: ACTIVE_VIEWER_SESSION_ID,
  };
}
