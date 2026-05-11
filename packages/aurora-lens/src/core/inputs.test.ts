import { describe, expect, it } from "vitest";
import { assertDecoder, assertFile, assertPageIndex } from "./inputs";

describe("inputs", () => {
  it("accepts browser File input", () => {
    expect(() => assertFile(new File(["data"], "sample.tiff", { type: "image/tiff" }))).not.toThrow();
  });

  it("rejects non-file TIFF input", () => {
    expect(() => assertFile("sample.tiff" as unknown as File)).toThrow("AuroraLens.decodeTiff: file must be a File.");
  });

  it("rejects invalid page indexes", () => {
    expect(() => assertPageIndex(-1)).toThrow("AuroraLens.decodeTiff: pageIndex must be a non-negative integer.");
    expect(() => assertPageIndex(1.5)).toThrow("AuroraLens.decodeTiff: pageIndex must be a non-negative integer.");
  });

  it("rejects missing decoders", () => {
    expect(() => assertDecoder(null)).toThrow("AuroraLens: decoder must implement decode and thumbnail.");
  });
});
