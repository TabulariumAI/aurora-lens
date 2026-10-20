import { expect, test } from "@playwright/test";

test("keeps source context and original name tokens for quoted and compound text", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/test-party-selection", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Source highlighting regression</title></head><body style="margin:0;font:16px sans-serif">
      <nav style="height:80px;display:flex;flex-wrap:wrap;gap:8px;align-content:center"><button id="borrower">Highlight borrower</button><button id="trustee">Highlight trustee</button></nav>
      <section style="height:calc(100vh - 80px)"><main id="viewer"></main></section>
      <script type="module">
        import { AuroraLens } from '/dist/index.js';
        const fixture = await (await fetch('/tests/fixtures/party-selection.json')).json();
        const metadata = fixture.metadata.pages[0];
        const raster = document.createElement('canvas');
        raster.width = metadata.width; raster.height = metadata.height;
        const context = raster.getContext('2d');
        context.fillStyle = 'white'; context.fillRect(0, 0, raster.width, raster.height);
        context.fillStyle = 'black'; context.font = '24px serif';
        metadata.tokens.forEach(token => context.fillText(token.content, token.polygon[0], token.polygon[1] + 24));
        const lens = new AuroraLens(document.querySelector('#viewer'), {
          pageSize: { formats: [{ name: 'letter', width: 8.5, height: 11 }], tolerance: 0.02 },
          allowEdit: false,
          onStateChange: state => { window.state = state; },
        });
        lens.loadMetadata(fixture.metadata);
        await lens.decodeDoc(new File([await new Promise(resolve => raster.toBlob(resolve))], 'parties.png', { type: 'image/png' }), { page: '1', viewMode: 'page' });
        for (const [position, id] of ['borrower', 'trustee'].entries()) document.querySelector('#' + id).onclick = () => {
          window.highlighted = lens.highlightIndex('1', fixture.indexes[position]);
          window.groups = lens.exportSelection();
        };
        window.ready = true;
      </script></body></html>`,
  }));
  await page.goto("/test-party-selection");
  await page.waitForFunction(() => window.ready === true);
  await expect(page.locator("#viewer img").first()).toBeVisible();
  await expect.poll(() => page.locator("#viewer img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect.poll(async () => (await page.locator("#viewer canvas").first().boundingBox())?.height ?? 0).toBeGreaterThan(100);
  for (const [name, count, tokens] of [
    ["borrower", 3, ["JOSE", "L.", "SALINAS,"]],
    ["trustee", 3, ["RUTH", "W.", "GARNER."]],
  ] as const) {
    await page.getByRole("button", { name: `Highlight ${name}`, exact: true }).click();
    expect(await page.evaluate(() => window.highlighted)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.state.selectionCounts)).toEqual({ tokens: count, context: 1, figures: 0 });
    const groups = await page.evaluate(() => (window as Window & { groups: { value: { token: string[]; context: string[] } }[] }).groups);
    expect(groups).toHaveLength(1);
    expect(groups[0].value.token).toEqual(tokens);
    expect(groups[0].value.context).toHaveLength(1);
    expect(groups[0].value.context[0]).toContain(name === "borrower" ? '"BORROWER" IS JOSE' : '"TRUSTEE" IS RUTH');
    await expect.poll(() => page.locator("#viewer canvas").first().evaluate((canvas: HTMLCanvasElement) =>
      canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0),
    )).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}-context.png`) });
  }
  expect(errors).toEqual([]);
});
