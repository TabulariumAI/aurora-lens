import { expect, test } from "@playwright/test";

test("production assets decode TIFF, PDF, PNG and JPEG and preserve the public PDF APIs", async ({ page }) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failedRequests.push(response.url()); });
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).lens));
  const result = await page.evaluate(async () => {
    const { DocumentDecoder, decodePdfBytes, decodePdfFile, defaultViewerConfig } = (window as any).lens;
    const fixtures = (window as any).fixtures;
    const stream = "BT /F1 24 Tf 72 700 Td (Production PDF) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((object, index) => {
      const offset = pdf.length;
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
      return offset;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const pdfFile = new File([pdf], "sample.pdf", { type: "application/pdf" });
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 30;
    canvas.getContext("2d")!.fillRect(0, 0, 20, 30);
    const jpeg = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/jpeg"));
    const files = [
      new File([await (await fetch(fixtures.tiff)).blob()], "sample.tiff", { type: "image/tiff" }),
      pdfFile,
      new File([await (await fetch(fixtures.png)).blob()], "sample.png", { type: "image/png" }),
      new File([jpeg], "sample.jpeg", { type: "image/jpeg" }),
    ];
    const decoded: { type: string; count: number; pages: number; hasInk: boolean }[] = [];
    let workerPdfHash = "";
    for (const file of files) {
      const decoder = new DocumentDecoder();
      let count = 0;
      let pages = 0;
      let hasInk = false;
      try {
        await decoder.decodeDoc(file, {
          pageCount(value: number) { count = value; },
          async pageReady(page: any) {
            pages++;
            hasInk ||= page.pixels.some((value: number, index: number) => index % 4 !== 3 && value < 200);
            if (file.type === "application/pdf") workerPdfHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", page.pixels))).join(",");
          },
        }, { ...defaultViewerConfig().view, pdfRasterDpi: 72 });
        decoded.push({ type: file.type, count, pages, hasInk });
      } finally { decoder.close(); }
    }
    const bytes = new Uint8Array(await pdfFile.arrayBuffer());
    const directBytes = await decodePdfBytes(bytes, "sample.pdf", { dpi: 72 });
    const directFile = await decodePdfFile(pdfFile, { dpi: 72 });
    const directHashes = await Promise.all([directBytes, directFile].map(async pages => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", pages[0].pixels))).join(",")));
    return { decoded, direct: [directBytes, directFile].map(pages => pages.map((page: any) => ({ width: page.width, height: page.height, dpi: page.xResolution }))), inputPreserved: bytes[0] === 37, identicalPdfPixels: directHashes.every(hash => hash === workerPdfHash) };
  });
  expect(result.decoded).toEqual([
    { type: "image/tiff", count: 2, pages: 2, hasInk: true },
    { type: "application/pdf", count: 1, pages: 1, hasInk: true },
    { type: "image/png", count: 1, pages: 1, hasInk: true },
    { type: "image/jpeg", count: 1, pages: 1, hasInk: true },
  ]);
  expect(result.direct).toEqual([[{ width: 612, height: 792, dpi: 72 }], [{ width: 612, height: 792, dpi: 72 }]]);
  expect(result.inputPreserved).toBe(true);
  expect(result.identicalPdfPixels).toBe(true);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("production TIFF viewing bounds decoding, restores sparse pages and preserves documents when saving settings", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).lens));
  await page.evaluate(async () => {
    const { AuroraLens, DocumentDecoder, IndexedDbViewerSessionStore } = (window as any).lens;
    const original = new Uint8Array(await (await fetch((window as any).fixtures.tiff)).arrayBuffer());
    const data = new DataView(original.buffer);
    const little = data.getUint16(0) === 0x4949;
    const first = data.getUint32(4, little);
    const directorySize = 2 + data.getUint16(first, little) * 12 + 4;
    const bytes = new Uint8Array(original.length + 20 * directorySize);
    bytes.set(original);
    const expanded = new DataView(bytes.buffer);
    expanded.setUint32(4, original.length, little);
    for (let index = 0; index < 20; index++) {
      const offset = original.length + index * directorySize;
      bytes.set(original.subarray(first, first + directorySize), offset);
      expanded.setUint32(offset + directorySize - 4, index === 19 ? 0 : offset + directorySize, little);
    }
    const calls: number[] = [];
    const decode = DocumentDecoder.prototype.decodePage;
    let pending = 0;
    let maxPending = 0;
    DocumentDecoder.prototype.decodePage = async function (file: File, pageIndex: number, ...args: any[]) {
      calls.push(pageIndex);
      maxPending = Math.max(maxPending, ++pending);
      try { return await decode.call(this, file, pageIndex, ...args); }
      finally { pending--; }
    };
    const store = new IndexedDbViewerSessionStore();
    let state: any;
    const options = { allowEdit: true, pageSize: { formats: [{ name: "letter", width: 8.5, height: 11 }], tolerance: 0.04 }, sessionStore: store, onStateChange(value: any) { state = value; }, onError(error: Error) { throw error; } };
    const viewer = new AuroraLens(document.getElementById("viewer"), options);
    Object.assign(window, { bounded: { viewer, store, options, calls, get state() { return state; }, get pending() { return pending; }, get maxPending() { return maxPending; } } });
    await viewer.decodeDoc(new File([bytes], "twenty.tiff", { type: "image/tiff" }), { page: 10, viewMode: "page" });
  });
  await expect.poll(() => page.evaluate(() => ({ calls: (window as any).bounded.calls, pending: (window as any).bounded.pending }))).toEqual({ calls: [9, 10, 8], pending: 0 });
  const result = await page.evaluate(async () => {
    const state = (window as any).bounded;
    const originalIds = (await state.store.read()).pages.map((page: any) => page.pageId);
    state.viewer.close();
    const restored = new (window as any).lens.AuroraLens(document.getElementById("viewer"), state.options);
    try {
      const didRestore = await restored.restoreSession();
      await restored.goToPage(20);
      const before = (await state.store.read()).pages.map((page: any) => page.pageId);
      const config = await restored.readViewerConfig();
      config.export.pdfRasterDpi = 72;
      await restored.saveViewerConfig(config);
      const after = (await state.store.read()).pages.map((page: any) => page.pageId);
      const blob = await restored.exportTiff();
      const decoder = new (window as any).lens.DocumentDecoder();
      let count = 0;
      try {
        await decoder.decodeDoc(new File([blob], "exported.tiff", { type: "image/tiff" }), { pageCount(value: number) { count = value; }, pageReady() {} }, config.view, () => 0);
      } finally { decoder.close(); }
      return { didRestore, originalIds, before, after, maxPending: state.maxPending, exportPages: count, dirty: restored.isDirty() };
    } finally { restored.close(); }
  });
  expect(result.didRestore).toBe(true);
  expect(result.originalIds).toHaveLength(20);
  expect(result.before).toEqual(result.originalIds);
  expect(result.after).toEqual(result.originalIds);
  expect(result.maxPending).toBe(1);
  expect(result.exportPages).toBe(20);
  expect(result.dirty).toBe(false);
  expect(errors).toEqual([]);
});
