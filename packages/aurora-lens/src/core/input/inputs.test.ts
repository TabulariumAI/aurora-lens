import { describe, expect, it } from "vitest";
import { assertDecodeOptions, assertFile, assertPageIndex, assertViewMode } from "./inputs";

describe("inputs", () => {
  it("accepts browser File input", () => {
    expect(() => assertFile(new File(["data"], "sample.tiff", { type: "image/tiff" }))).not.toThrow();
  });

  it("rejects non-file document input", () => {
    expect(() => assertFile("sample.tiff" as unknown as File)).toThrow("AuroraLens.decodeDoc: file must be a File.");
  });

  it("rejects invalid page indexes", () => {
    expect(() => assertPageIndex(-1)).toThrow("AuroraLens.decodeDoc: page must be a non-negative integer.");
    expect(() => assertPageIndex(1.5)).toThrow("AuroraLens.decodeDoc: page must be a non-negative integer.");
  });

  it("rejects invalid decode options", () => {
    expect(() => assertDecodeOptions(undefined as never)).toThrow("AuroraLens.decodeDoc: options must include page and viewMode.");
  });

  it("rejects invalid view modes", () => {
    expect(() => assertViewMode("grid" as never)).toThrow("AuroraLens.decodeDoc: viewMode must be page or thumbnails.");
  });
});
