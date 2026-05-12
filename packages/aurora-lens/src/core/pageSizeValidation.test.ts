import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_FORMATS,
  DEFAULT_PAGE_TOLERANCE,
  validateRasterPageSize,
  type PageSizeConfig,
} from "./pageSizeValidation";

const config: PageSizeConfig = {
  formats: DEFAULT_PAGE_FORMATS,
  tolerance: DEFAULT_PAGE_TOLERANCE,
};

describe("validateRasterPageSize", () => {
  it("exports default page formats", () => {
    expect(DEFAULT_PAGE_FORMATS).toEqual([
      { name: "letter", width: 8.5, height: 11 },
      { name: "legal", width: 8.5, height: 14 },
      { name: "a4", width: 8.27, height: 11.69 },
    ]);
    expect(DEFAULT_PAGE_TOLERANCE).toBe(0.02);
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
    });
  });
});
