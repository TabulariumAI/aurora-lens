import { describe, expect, it } from "vitest";
import {
  validateRasterPageSize,
  type PageSizeConfig,
} from "./pageSizeValidation";

const config: PageSizeConfig = {
  formats: [
    { name: "letter", width: 8.5, height: 11 },
    { name: "legal", width: 8.5, height: 14 },
    { name: "a4", width: 8.27, height: 11.69 },
  ],
  tolerance: 0.02,
};


describe("validateRasterPageSize", () => {
  it.each([
    [1275, 1739, 150, 150],
    [1739, 1275, 150, 150],
    [1275, 1739, 0, 0],
  ])("rejects the reported page size %sx%s with resolution %sx%s", (width, height, xResolution, yResolution) => {
    expect(validateRasterPageSize({ width, height, xResolution, yResolution }, config)).toEqual({
      valid: false,
      reason: `Page size ${width}x${height} does not match configured formats`,
      requiredTolerance: expect.any(Number),
    });
  });

  it.each([0.02, 0.04])("uses the supplied tolerance %s", tolerance => {
    const result = validateRasterPageSize({ width: 1275, height: 1739, xResolution: 150, yResolution: 150 }, { ...config, tolerance });
    expect(result.valid).toBe(tolerance === 0.04);
  });

  it.each(config.formats.flatMap(format => [
    [format, false], [format, true],
  ] as const))("accepts configured format %o in landscape=%s", (format, landscape) => {
    const width = (landscape ? format.height : format.width) * 150;
    const height = (landscape ? format.width : format.height) * 150;
    expect(validateRasterPageSize({ width, height, xResolution: 150, yResolution: 150 }, config))
      .toMatchObject({ valid: true, documentType: format.name });
  });

  it("validates a page by physical size from existing resolution", () => {
    expect(validateRasterPageSize({
      width: 2550,
      height: 3300,
      xResolution: 300,
      yResolution: 300,
    }, config)).toEqual({
      valid: true,
      documentType: "letter",
      xResolution: 300,
      yResolution: 300,
      physicalWidth: 8.5,
      physicalHeight: 11,
    });
  });

  it("validates landscape pages by physical size", () => {
    expect(validateRasterPageSize({
      width: 3300,
      height: 2550,
      xResolution: 300,
      yResolution: 300,
    }, config)).toEqual({
      valid: true,
      documentType: "letter",
      xResolution: 300,
      yResolution: 300,
      physicalWidth: 11,
      physicalHeight: 8.5,
    });
  });

  it("infers resolution by aspect ratio when resolution is missing", () => {
    expect(validateRasterPageSize({
      width: 2481,
      height: 3507,
      xResolution: 0,
      yResolution: 0,
    }, config)).toEqual({
      valid: true,
      documentType: "a4",
      xResolution: 300,
      yResolution: 300,
      physicalWidth: 8.27,
      physicalHeight: 11.69,
    });
  });

  it("rejects pages outside configured formats", () => {
    expect(validateRasterPageSize({
      width: 1000,
      height: 1000,
      xResolution: 300,
      yResolution: 300,
    }, config)).toEqual({
      valid: false,
      reason: "Page size 1000x1000 does not match configured formats",
      requiredTolerance: expect.any(Number),
    });
  });
});


it.each([
  [1275, 1739, 150, 150], [1739, 1275, 150, 150],
  [1275, 1739, 0, 0], [1000, 1000, 300, 300],
  [900, 1300, 100, 110], [1300, 900, 110, 100],
])("reports the minimum accepting tolerance for %sx%s at %sx%s", (width, height, xResolution, yResolution) => {
  const page = { width, height, xResolution, yResolution };
  const result = validateRasterPageSize(page, config);
  expect(result.valid).toBe(false);
  if (result.valid) throw new Error("Expected a page-size rejection.");
  const tolerances = config.formats.flatMap(format => {
    const ratio = Math.abs((Math.max(width, height) / Math.min(width, height)) /
      (Math.max(format.width, format.height) / Math.min(format.width, format.height)) - 1);
    return xResolution > 0 && yResolution > 0 ? [ratio,
      Math.max(Math.abs(width / xResolution / format.width - 1), Math.abs(height / yResolution / format.height - 1)),
      Math.max(Math.abs(width / xResolution / format.height - 1), Math.abs(height / yResolution / format.width - 1)),
    ] : [ratio];
  });
  expect(result.requiredTolerance).toBe(Math.min(...tolerances));
  expect(validateRasterPageSize(page, { ...config, tolerance: result.requiredTolerance }).valid).toBe(true);
  expect(validateRasterPageSize(page, { ...config, tolerance: result.requiredTolerance - 1e-8 }).valid).toBe(false);
  expect(config.tolerance).toBe(0.02);
});

it("preserves physical matching priority and configured order", () => {
  const page = { width: 1275, height: 1650, xResolution: 150, yResolution: 150 };
  expect(validateRasterPageSize(page, { formats: [...config.formats].reverse(), tolerance: 0.02 }))
    .toMatchObject({ valid: true, documentType: "letter", xResolution: 150, yResolution: 150 });
  expect(validateRasterPageSize({ ...page, xResolution: 0, yResolution: 0 }, config))
    .toMatchObject({ valid: true, documentType: "letter" });
});


it.each([0, 150, 300])("accepts the reported preview size with the current 5% policy at %s dpi", resolution => {
  expect(validateRasterPageSize({ width: 2550, height: 3479, xResolution: resolution, yResolution: resolution }, { ...config, tolerance: 0.05 }).valid).toBe(true);
});
