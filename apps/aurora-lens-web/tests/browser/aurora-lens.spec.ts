import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import {
  ACTIVE_VIEWER_SESSION_ID,
  VIEWER_DOCUMENT_STORE_NAME,
  VIEWER_PAGE_BLOB_STORE_NAME,
  VIEWER_PAGE_STORE_NAME,
  VIEWER_SESSION_DB_NAME,
  VIEWER_SESSION_DB_VERSION,
} from "../../../../packages/aurora-lens/src/core/viewerSessionStore";
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
  const firstCard = page.locator("[data-aurora-thumbnail-card]").first();
  await expect(firstCard).toBeVisible();
  await expect
    .poll(() => firstCard.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(255, 255, 255)");
  await expect
    .poll(() => firstCard.evaluate((element) => getComputedStyle(element).borderTopWidth))
    .toBe("0px");
  await expect
    .poll(() => page.locator("[aria-current='page']").evaluate((element) => getComputedStyle(element.closest("[data-aurora-thumbnail-card]")!).borderTopWidth))
    .toBe("1px");
  await expect
    .poll(() => page.locator(".viewer-body > div").first().evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  const thumbnailGrid = page.locator(".viewer-body > div > div").nth(1);
  await expect.poll(() => thumbnailGrid.evaluate((element) => getComputedStyle(element).overflow)).toBe("auto");
  await expect.poll(() => thumbnailGrid.evaluate((element) => getComputedStyle(element).height)).not.toBe("520px");
  await expect
    .poll(() => firstCard.evaluate((element) => getComputedStyle(element).boxShadow))
    .toBe("none");
  const thumbnailBox = await page.getByRole("button", { name: /page 1/i }).boundingBox();
  expect(thumbnailBox).not.toBeNull();
  const thumbnailImage = page.locator('img[alt="sample-multipage.tiff page 1"]').first();
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
  await expect.poll(async () => (await page.locator("[data-aurora-thumbnail-card]").first().boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(460);
  await expect.poll(async () => (await page.locator("[data-aurora-thumbnail-card]").first().boundingBox())?.height ?? 0).toBeLessThanOrEqual(505);
  await expect.poll(() => thumbnailOverlapCount(page)).toBe(0);
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

test("navigates by reordered thumbnail sequence", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "sample-2" }).click();
  const details = page.getByLabel("Page details");
  await expect(details.getByText("1 of 5")).toBeVisible();
  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByRole("button", { name: "Page 2" })).toBeVisible();
  await expect(page.locator("[data-thumbnail-media] img")).toHaveCount(5);
  const thumbnailGrid = page.locator("[data-aurora-thumbnail-card]").first().locator("..");
  await thumbnailGrid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const scrollTop = await thumbnailGrid.evaluate((element) => element.scrollTop);
  await page.locator("[data-thumbnail-media] img").evaluateAll((images) => {
    images.forEach((image, index) => image.setAttribute("data-probe-id", `image-${index}`));
  });
  await dragThumbnail(page, 1, 0);
  await expect.poll(() => thumbnailGrid.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await expect.poll(() => page.locator("[data-thumbnail-media] img").evaluateAll((images) => images.map((image) => image.getAttribute("data-probe-id")))).toEqual([
    "image-1",
    "image-0",
    "image-2",
    "image-3",
    "image-4",
  ]);
  await expect.poll(() => storedPages(page), { timeout: 45000 }).toEqual([
    { sequenceNumber: 1, sourcePageIndex: 1 },
    { sequenceNumber: 2, sourcePageIndex: 0 },
    { sequenceNumber: 3, sourcePageIndex: 2 },
    { sequenceNumber: 4, sourcePageIndex: 3 },
    { sequenceNumber: 5, sourcePageIndex: 4 },
  ]);
  await page.locator("[data-page-select='true']").first().click();
  await expect(details.getByText("1 of 5")).toBeVisible();
  await expect.poll(() => storedPageIndex(page)).toBe(1);

  await page.getByRole("button", { name: "Next page" }).click();

  await expect(details.getByText("2 of 5")).toBeVisible();
  await expect.poll(() => storedPageIndex(page)).toBe(0);
});

test("adds TIFF pages from thumbnail add button and stores the inserted pages", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");

  const fixture = path.resolve("tests/fixtures/sample-multipage.tiff");
  await page.getByLabel("Load TIFF").setInputFiles(fixture);
  const details = page.getByLabel("Page details");
  await expect(details.getByText("1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "All thumbnails" }).click();
  await expect(page.getByRole("button", { name: "Page 2" })).toBeVisible();

  const firstCard = page.locator('[data-page-index="0"]');
  await firstCard.hover();
  const chooserPromise = page.waitForEvent("filechooser");
  await firstCard.locator('button[aria-label="Add after"]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);

  await expect.poll(() => storedPages(page), { timeout: 45000 }).toEqual([
    { sequenceNumber: 1, sourcePageIndex: 0 },
    { sequenceNumber: 2, sourcePageIndex: 0 },
    { sequenceNumber: 3, sourcePageIndex: 1 },
    { sequenceNumber: 4, sourcePageIndex: 1 },
  ]);
  await expect(page.getByRole("button", { name: "Page 4" })).toBeVisible({ timeout: 45000 });
  await expect.poll(() => storedBlobCount(page)).toBeGreaterThanOrEqual(4);

  await page.getByRole("button", { name: "Page 2" }).click();

  await expect(details.getByText("2 of 4")).toBeVisible();
  await expect.poll(() => storedPageIndex(page)).toBe(0);
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
  return page.evaluate(async ({ databaseName, databaseVersion, documentStoreName, pageStoreName, sessionId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number | null>((resolve, reject) => {
        const transaction = database.transaction([documentStoreName, pageStoreName], "readonly");
        const documentRequest = transaction.objectStore(documentStoreName).get(sessionId);
        const pagesRequest = transaction.objectStore(pageStoreName).getAll();
        transaction.oncomplete = () => {
          const document = documentRequest.result as { currentPageId?: unknown } | undefined;
          const pages = pagesRequest.result as Array<{ pageId?: unknown; sourcePageIndex?: unknown }>;
          const currentPage = pages.find((record) => record.pageId === document?.currentPageId);
          resolve(typeof currentPage?.sourcePageIndex === "number" ? currentPage.sourcePageIndex : null);
        };
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, viewerSessionContext());
}

async function storedPages(page: Page) {
  return page.evaluate(async ({ databaseName, databaseVersion, pageStoreName }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ sequenceNumber: number; sourcePageIndex: number }>>((resolve, reject) => {
        const transaction = database.transaction(pageStoreName, "readonly");
        const pagesRequest = transaction.objectStore(pageStoreName).getAll();
        transaction.oncomplete = () => {
          const pages = pagesRequest.result as Array<{ sequenceNumber?: unknown; sourcePageIndex?: unknown }>;
          resolve(pages.map((record) => ({
            sequenceNumber: Number(record.sequenceNumber),
            sourcePageIndex: Number(record.sourcePageIndex),
          })).sort((left, right) => left.sequenceNumber - right.sequenceNumber));
        };
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, viewerSessionContext());
}

async function storedBlobCount(page: Page) {
  return page.evaluate(async ({ blobStoreName, databaseName, databaseVersion }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(blobStoreName, "readonly");
        const blobsRequest = transaction.objectStore(blobStoreName).getAll();
        transaction.oncomplete = () => resolve(blobsRequest.result.length);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, viewerSessionContext());
}

async function dragThumbnail(page: Page, sourcePageIndex: number, targetPageIndex: number) {
  await page.evaluate(({ sourcePageIndex, targetPageIndex }) => {
    const source = document.querySelector(`[data-page-index="${sourcePageIndex}"] [data-thumbnail-drag-handle="true"]`);
    const target = document.querySelector(`[data-page-index="${targetPageIndex}"]`);
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error("Missing thumbnail drag source or target.");
    }
    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, { sourcePageIndex, targetPageIndex });
}

async function thumbnailOverlapCount(page: Page) {
  return page.locator("[data-aurora-thumbnail-card]").evaluateAll((cards) => {
    const rects = cards.map((card) => card.getBoundingClientRect());
    let count = 0;
    for (let index = 0; index < rects.length; index += 1) {
      for (let next = index + 1; next < rects.length; next += 1) {
        const currentRect = rects[index];
        const nextRect = rects[next];
        if (currentRect.left < nextRect.right && nextRect.left < currentRect.right && currentRect.top < nextRect.bottom && nextRect.top < currentRect.bottom) {
          count += 1;
        }
      }
    }
    return count;
  });
}

async function seedCorruptSession(page: Page) {
  await page.evaluate(async ({ databaseName, databaseVersion, documentStoreName, sessionId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(documentStoreName, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.objectStore(documentStoreName).put({
          id: sessionId,
          fileName: "corrupt.tiff",
          fileType: "image/tiff",
          currentPageId: "missing-page",
          updatedAt: Date.now(),
        });
      });
    } finally {
      database.close();
    }
  }, viewerSessionContext());
}

function viewerSessionContext() {
  return {
    databaseName: VIEWER_SESSION_DB_NAME,
    databaseVersion: VIEWER_SESSION_DB_VERSION,
    blobStoreName: VIEWER_PAGE_BLOB_STORE_NAME,
    documentStoreName: VIEWER_DOCUMENT_STORE_NAME,
    pageStoreName: VIEWER_PAGE_STORE_NAME,
    sessionId: ACTIVE_VIEWER_SESSION_ID,
  };
}
