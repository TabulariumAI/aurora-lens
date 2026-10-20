import { describe, expect, it } from "vitest";
import { pageRect, screenToDisplay, screenToPage } from "./coordinates";

describe("coordinates", () => {
  it("maps screen points into page pixels", () => {
    expect(screenToPage(25, 40, { left: 5, top: 10, width: 100, height: 200 }, 1000, 2000, true)).toEqual({
      x: 200,
      y: 300,
    });
  });

  it("returns null for required outside points", () => {
    expect(screenToPage(1, 40, { left: 5, top: 10, width: 100, height: 200 }, 1000, 2000, true)).toBeNull();
    expect(screenToDisplay(1, 40, { left: 5, top: 10, width: 100, height: 200 }, true)).toBeNull();
  });

  it("creates clamped page rectangles", () => {
    expect(pageRect({ x: 90, y: 10 }, { x: 10, y: 40 }, 100, 50)).toEqual({
      x: 10,
      y: 10,
      width: 80,
      height: 30,
    });
  });
});
