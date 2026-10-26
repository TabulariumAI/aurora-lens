import { expect, test } from "@playwright/test";
import type { PageMetadataHits, ViewerState } from "../../src/core/types";
import { textMetadata } from "../fixtures/textMetadata";

declare global {
  interface Window {
    ready: boolean;
    hits: PageMetadataHits;
    highlighted: boolean;
    state: ViewerState;
  }
}

test("matches the original beneficiary text through value-only page fallback in Edge", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/test-beneficiary", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Lens beneficiary search</title></head><body style="margin:0;font:16px sans-serif">
      <nav style="height:48px;display:flex;gap:8px;align-items:center;padding:0 8px;font-size:12px">
        <button id="highlight">Highlight index</button><button id="missing">Missing index</button><button id="ordered">Ordered search</button><button id="reversed">Reversed search</button><output id="result"></output>
      </nav><section style="height:calc(100vh - 48px)"><main id="viewer"></main></section>
      <script type="module">
        import { AuroraLens } from '/dist/index.js';
        const fixture = await (await fetch('/tests/fixtures/beneficiary.json')).json();
        const lens = new AuroraLens(document.querySelector('#viewer'), { pageSize: { formats: [{ name: "letter", width: 8.5, height: 11 }], tolerance: 0.02 }, allowEdit: false, onStateChange: state => { window.state = state; } });
        lens.loadMetadata(fixture.metadata);
        await lens.decodeDoc(new File([await (await fetch('/tests/fixtures/beneficiary.png')).blob()], 'beneficiary.png', { type: 'image/png' }), { page: '2', viewMode: 'page' });
        document.querySelector('#highlight').onclick = () => {
          window.highlighted = lens.highlightIndex('2', fixture.index);
          document.querySelector('#result').textContent = window.highlighted ? 'Highlighted' : 'No match';
        };
        document.querySelector('#missing').onclick = () => {
          window.highlighted = lens.highlightIndex('2', { ...fixture.index, value: 'ABSENT BENEFICIARY' });
          document.querySelector('#result').textContent = window.highlighted ? 'Highlighted' : 'No match';
        };
        document.querySelector('#ordered').onclick = () => {
          window.hits = lens.search('TYRANXE CICEK');
          document.querySelector('#result').textContent = window.hits.tokens.length + ' name tokens';
        };
        document.querySelector('#reversed').onclick = () => {
          window.hits = lens.search('CICEK TYRANXE');
          document.querySelector('#result').textContent = window.hits.tokens.length + ' name tokens';
        };
        window.ready = true;
      </script></body></html>`,
  }));
  await page.goto("/test-beneficiary");
  await page.waitForFunction(() => window.ready === true);
  await expect.poll(() => page.locator("#viewer img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Highlight index", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("Highlighted");
  expect(await page.evaluate(() => window.highlighted)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 2, context: 1, figures: 0 });
  await page.getByRole("button", { name: "Missing index", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("No match");
  expect(await page.evaluate(() => window.highlighted)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 0, context: 0, figures: 0 });
  await page.getByRole("button", { name: "Ordered search", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("2 name tokens");
  expect(await page.evaluate(() => window.hits.tokens.map(token => token.token))).toEqual(["Tyranie", "Cicek"]);
  expect(await page.evaluate(() => window.hits.contexts.map(context => context.content))).toEqual(["Name: Tyranie Cicek"]);
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 2, context: 1, figures: 0 });
  await page.getByRole("button", { name: "Reversed search", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("0 name tokens");
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 0, context: 0, figures: 0 });
  await expect.poll(() => page.locator("#viewer canvas").first().evaluate((canvas: HTMLCanvasElement) => canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => index % 4 !== 3 || value === 0))).toBe(true);
  await page.getByRole("button", { name: "Ordered search", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("2 name tokens");
  expect(errors).toEqual([]);
});

test("renders top-one Index Highlight, all exact and fuzzy Search results, source-only success and page fallback", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const metadata = textMetadata("seller recorder bravo alpha bravo alpha", "seller recorder absent", "bravo alpha outsider", "seller recorder alphx bravo", "seller recorder alpha bravo", "seller recorder alpha bravo");
  metadata.pages[0].width = 850;
  metadata.pages[0].height = 1100;
  metadata.pages[0].tokens.forEach(token => { token.polygon = token.polygon.map(value => value * 3); });
  metadata.pages[0].contexts.forEach(context => { context.polygon = context.polygon.map(value => value === 10000 ? 800 : value * 3); });
  await page.route("**/test-highlight", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Index highlighting</title></head><body style="margin:0;font:16px sans-serif">
      <nav style="height:96px;display:flex;flex-wrap:wrap;gap:8px;align-content:center;padding:0 8px">
        <button id="highlight">Highlight values</button><button id="source">Highlight paragraph</button><button id="fallback">Page fallback</button><button id="search">Search all</button><button id="missing">No match</button><output id="result"></output>
      </nav><section style="height:calc(100vh - 96px)"><main id="viewer"></main></section>
      <script type="module">
        import { AuroraLens } from '/dist/index.js';
        const metadata = ${JSON.stringify(metadata)};
        const raster = document.createElement('canvas');
        raster.width = 850; raster.height = 1100;
        const context = raster.getContext('2d');
        context.fillStyle = 'white'; context.fillRect(0, 0, 850, 1100);
        context.fillStyle = 'black'; context.font = '16px sans-serif';
        metadata.pages[0].tokens.forEach(token => context.fillText(token.content, token.polygon[0], token.polygon[1] + 24, 54));
        const lens = new AuroraLens(document.querySelector('#viewer'), { pageSize: { formats: [{ name: "letter", width: 8.5, height: 11 }], tolerance: 0.02 }, allowEdit: false, onStateChange: state => { window.state = state; } });
        lens.loadMetadata(metadata);
        await lens.decodeDoc(new File([await new Promise(resolve => raster.toBlob(resolve))], 'paragraphs.png', { type: 'image/png' }), { page: 1, viewMode: 'page' });
        const requests = {
          highlight: { value: 'alpha bravo', source: 'seller recorder' },
          source: { value: 'missing', source: 'seller recorder' },
          fallback: { value: 'alpha bravo', source: 'unmatched source' },
          missing: { value: 'missing', source: 'unmatched source' },
        };
        for (const [id, index] of Object.entries(requests)) document.querySelector('#' + id).onclick = () => {
          window.highlighted = lens.highlightIndex(1, { ...index, label: 'Name', ambiguous: 'NO' });
          document.querySelector('#result').textContent = window.highlighted ? 'Highlighted' : 'No match';
        };
        document.querySelector('#search').onclick = () => {
          window.hits = lens.search('alpha bravo');
          document.querySelector('#result').textContent = window.hits.tokens.length + ' name tokens';
        };
        window.ready = true;
      </script></body></html>`,
  }));
  await page.goto("/test-highlight");
  await page.waitForFunction(() => window.ready === true);
  await page.getByRole("button", { name: "Highlight values", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("Highlighted");
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 2, context: 1, figures: 0 });
  await page.screenshot({ path: testInfo.outputPath("source-values.png") });
  await page.getByRole("button", { name: "Highlight paragraph", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("Highlighted");
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 0, context: 1, figures: 0 });
  expect(await page.evaluate(() => window.state.canCopy)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("source-only.png") });
  await page.getByRole("button", { name: "Page fallback", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("Highlighted");
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 2, context: 1, figures: 0 });
  await page.screenshot({ path: testInfo.outputPath("fallback-values.png") });
  await page.getByRole("button", { name: "Search all", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("8 name tokens");
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 8, context: 4, figures: 0 });
  expect(await page.evaluate(() => window.hits.contexts.map(context => context.content))).toEqual([
    "seller recorder bravo alpha bravo alpha", "seller recorder alphx bravo", "seller recorder alpha bravo", "seller recorder alpha bravo",
  ]);
  await page.screenshot({ path: testInfo.outputPath("search-all.png") });
  await page.getByRole("button", { name: "No match", exact: true }).click();
  await expect(page.locator("#result")).toHaveText("No match");
  await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 0, context: 0, figures: 0 });
  await expect.poll(() => page.locator("#viewer canvas").first().evaluate((canvas: HTMLCanvasElement) => canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => index % 4 !== 3 || value === 0))).toBe(true);
  const viewer = await page.locator("#viewer").boundingBox();
  expect(viewer!.width).toBeGreaterThan(0);
  expect(viewer!.height).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
