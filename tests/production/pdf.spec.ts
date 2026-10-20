import { expect, test } from "@playwright/test";
import { scannedPdf } from "../fixtures/scannedPdf";

for (const filter of ["JBIG2Decode", "CCITTFaxDecode"] as const) {
  test("production " + filter + " images render through the worker and public PDF APIs", async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const failedRequests: string[] = [];
    const resources: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "warning" && message.text() !== "Warning: Setting up fake worker.") warnings.push(message.text());
    });
    page.on("response", response => { if (response.status() >= 400) failedRequests.push(response.url()); });
    page.on("request", request => { if (/jbig2.*\.(wasm|js)/.test(request.url())) resources.push(request.url()); });
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).lens));
    const result = await page.evaluate(async bytes => {
      const { DocumentDecoder, decodePdfBytes, decodePdfFile, defaultViewerConfig } = (window as any).lens;
      const file = new File([new Uint8Array(bytes)], "scan.pdf", { type: "application/pdf" });
      const summarize = async (page: any) => ({
        page: page.pageNumber,
        width: page.width,
        height: page.height,
        hasInk: page.pixels.some((value: number, index: number) => index % 4 !== 3 && value < 200 && page.pixels[index - index % 4 + 3] > 0),
        hash: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", page.pixels))).join(","),
      });
      const worker: Awaited<ReturnType<typeof summarize>>[] = [];
      let count = 0;
      const decoder = new DocumentDecoder();
      try {
        await decoder.decodeDoc(file, {
          pageCount(value: number) { count = value; },
          async pageReady(page: any) { worker.push(await summarize(page)); },
        }, { ...defaultViewerConfig().view, pdfRasterDpi: 72 });
      } finally { decoder.close(); }
      const input = new Uint8Array(bytes);
      const direct = await Promise.all((await decodePdfBytes(input, "scan.pdf", { dpi: 72 })).map(summarize));
      const fromFile = await Promise.all((await decodePdfFile(file, { dpi: 72 })).map(summarize));
      return { count, worker, direct, fromFile, inputPreserved: input.every((value, index) => value === bytes[index]) };
    }, Array.from(scannedPdf(filter)));
    expect(result.count).toBe(3);
    expect(result.worker).toHaveLength(3);
    expect(result.worker.map(({ page, width, height, hasInk }) => ({ page, width, height, hasInk }))).toEqual(
      [1, 2, 3].map(page => ({ page, width: 612, height: 792, hasInk: true })),
    );
    expect(result.direct).toEqual(result.worker);
    expect(result.fromFile).toEqual(result.worker);
    expect(result.inputPreserved).toBe(true);
    expect(resources.some(url => /jbig2[^/]*\.wasm$/.test(url))).toBe(true);
    expect(resources.some(url => url.includes("nowasm_fallback"))).toBe(false);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  for (const viewport of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    test("production " + filter + " thumbnails navigate, reopen and restore at " + viewport.width + "px", async ({ page }, testInfo) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => {
        if (message.type() === "warning" && message.text() !== "Warning: Setting up fake worker.") warnings.push(message.text());
      });
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.waitForFunction(() => Boolean((window as any).lens));
      await page.evaluate(async bytes => {
        const { AuroraLens, IndexedDbViewerSessionStore } = (window as any).lens;
        document.body.style.height = "calc(100vh - 16px)";
        const errors: string[] = [];
        let state: any;
        const options = {
          pageSize: { formats: [{ name: "letter", width: 8.5, height: 11 }], tolerance: 0.02 },
          sessionStore: new IndexedDbViewerSessionStore(),
          onStateChange(value: any) { state = value; },
          onError(error: Error) { errors.push(error.message); },
        };
        const viewer = new AuroraLens(document.getElementById("viewer")!, options);
        Object.assign(window, { scan: { viewer, options, errors, get state() { return state; } } });
        await viewer.decodeDoc(new File([new Uint8Array(bytes)], "scan.pdf", { type: "application/pdf" }), { page: 1, viewMode: "thumbnails" });
      }, Array.from(scannedPdf(filter)));
      for (const phase of ["opened", "reopened", "restored"] as const) {
        await expect(page.locator("#viewer")).toHaveJSProperty("clientHeight", viewport.height - 16);
        const images = page.locator("[data-thumbnail-media] img");
        await expect(images).toHaveCount(3);
        for (const image of await images.all()) {
          await expect(image).toBeVisible();
          expect(await image.evaluate(async (image: HTMLImageElement) => {
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            return data.some((value, index) => index % 4 !== 3 && value < 200 && data[index - index % 4 + 3] > 0);
          })).toBe(true);
        }
        await page.screenshot({ path: testInfo.outputPath(phase + ".png") });
        if (phase === "opened") {
          await page.getByRole("button", { name: "Page 2", exact: true }).click();
          await expect.poll(() => page.evaluate(() => (window as any).scan.state.pageIndex)).toBe(1);
          await expect(page.locator("#viewer img:visible")).toHaveCount(1);
          await page.evaluate(() => (window as any).scan.viewer.nextPage());
          await expect.poll(() => page.evaluate(() => (window as any).scan.state.pageIndex)).toBe(2);
          await page.evaluate(() => (window as any).scan.viewer.previousPage());
          await expect.poll(() => page.evaluate(() => (window as any).scan.state.pageIndex)).toBe(1);
          await page.evaluate(() => (window as any).scan.viewer.showThumbnails());
        } else if (phase === "reopened") {
          expect(await page.evaluate(async () => {
            const scan = (window as any).scan;
            scan.viewer.close();
            scan.viewer = new (window as any).lens.AuroraLens(document.getElementById("viewer"), scan.options);
            const restored = await scan.viewer.restoreSession();
            await scan.viewer.showThumbnails();
            return restored;
          })).toBe(true);
        }
      }
      expect(await page.evaluate(() => (window as any).scan.errors)).toEqual([]);
      await page.evaluate(() => (window as any).scan.viewer.close());
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
    });
  }
}

