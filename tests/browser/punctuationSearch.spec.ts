import { expect, test } from "@playwright/test";
import { textMetadata } from "../fixtures/textMetadata";

for (const [bank, query] of [
  ["Wells Fargo Bank, N.A.", "WELLS FARGO BANK NA"],
  ["WELLS FARGO BANK NA", "Wells Fargo Bank, N.A."],
] as const) {
  test(`ignores periods and commas in rendered Search and index Highlight: ${bank}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const metadata = textMetadata(`Lender ${bank}`, `Recorder ${bank}`);
    metadata.pages[0].width = 850;
    metadata.pages[0].height = 1100;
    metadata.pages[0].tokens.forEach(token => { token.polygon = token.polygon.map(value => value * 5); });
    metadata.pages[0].contexts.forEach(context => { context.polygon = context.polygon.map(value => value === 10000 ? 800 : value * 5); });
    await page.route("**/test-punctuation", route => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><title>Punctuation search</title></head><body style="margin:0;font:16px sans-serif">
        <nav style="height:96px;display:flex;flex-wrap:wrap;gap:8px;align-content:center;padding:0 8px">
          <button id="search">Search</button><button id="highlight">Highlight index</button><button id="fallback">Page highlight</button><button id="reverse">Reverse search</button><button id="clear">Clear</button><output id="result"></output>
        </nav><section style="height:calc(100vh - 96px)"><main id="viewer"></main></section>
        <script type="module">
          import { AuroraLens } from '/dist/index.js';
          const metadata = ${JSON.stringify(metadata)};
          const query = ${JSON.stringify(query)};
          const raster = document.createElement('canvas');
          raster.width = 850; raster.height = 1100;
          const context = raster.getContext('2d');
          context.fillStyle = 'white'; context.fillRect(0, 0, 850, 1100);
          context.fillStyle = 'black'; context.font = '20px sans-serif';
          metadata.pages[0].tokens.forEach(token => context.fillText(token.content, token.polygon[0], token.polygon[1] + 30, 90));
          const lens = new AuroraLens(document.querySelector('#viewer'), { pageSize: { formats: [{ name: 'letter', width: 8.5, height: 11 }], tolerance: 0.02 }, allowEdit: false, onStateChange: state => { window.state = state; } });
          lens.loadMetadata(metadata);
          await lens.decodeDoc(new File([await new Promise(resolve => raster.toBlob(resolve))], 'bank.png', { type: 'image/png' }), { page: 1, viewMode: 'page' });
          document.querySelector('#search').onclick = () => {
            window.hits = lens.search(query, { context: 'lender AND ' + query });
            document.querySelector('#result').textContent = window.hits.tokens.length + ' tokens';
          };
          document.querySelector('#highlight').onclick = () => {
            window.highlighted = lens.highlightIndex(1, { value: query.split(' ').reverse().join(' '), source: 'Lender ' + query, label: 'Name', ambiguous: 'NO' });
            document.querySelector('#result').textContent = window.highlighted ? 'Highlighted' : 'No match';
          };
          document.querySelector('#fallback').onclick = () => {
            window.highlighted = lens.highlightIndex(1, { value: query, source: '', label: 'Name', ambiguous: 'NO' });
            document.querySelector('#result').textContent = window.highlighted ? 'Highlighted' : 'No match';
          };
          document.querySelector('#reverse').onclick = () => {
            window.hits = lens.search(query.split(' ').reverse().join(' '));
            document.querySelector('#result').textContent = window.hits.tokens.length + ' tokens';
          };
          document.querySelector('#clear').onclick = () => {
            window.hits = lens.search('.,');
            document.querySelector('#result').textContent = window.hits.tokens.length + ' tokens';
          };
          window.ready = true;
        </script></body></html>`,
    }));
    await page.goto("/test-punctuation");
    await page.waitForFunction(() => window.ready === true);
    await expect(page.locator("#viewer img").first()).toBeVisible();
    await expect.poll(() => page.locator("#viewer img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("4 tokens");
    expect(await page.evaluate(() => window.hits.tokens.map(token => token.token))).toEqual(metadata.pages[0].tokens.slice(1, 5).map(token => token.content));
    expect(await page.evaluate(() => window.hits.tokens.map(token => token.polygon))).toEqual(metadata.pages[0].tokens.slice(1, 5).map(token => token.polygon));
    expect(await page.evaluate(() => window.hits.contexts.map(context => context.content))).toEqual([`Lender ${bank}`]);
    await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 4, context: 1, figures: 0 });
    await expect.poll(() => page.locator("#viewer canvas").first().evaluate((canvas: HTMLCanvasElement) =>
      canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0),
    )).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("bank-search.png") });
    await page.getByRole("button", { name: "Reverse search", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("0 tokens");
    await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 0, context: 0, figures: 0 });
    await page.getByRole("button", { name: "Highlight index", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("Highlighted");
    await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 4, context: 1, figures: 0 });
    await page.screenshot({ path: testInfo.outputPath("bank-index.png") });
    await page.getByRole("button", { name: "Page highlight", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("Highlighted");
    await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 4, context: 0, figures: 0 });
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.locator("#result")).toHaveText("0 tokens");
    await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: 0, context: 0, figures: 0 });
    await expect.poll(() => page.locator("#viewer canvas").first().evaluate((canvas: HTMLCanvasElement) =>
      canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => index % 4 !== 3 || value === 0),
    )).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
