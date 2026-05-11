import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataHelper } from "./MetadataHelper";
import { PageViewer } from "./PageViewer";
import { SelectionManager } from "./SelectionManager";
import { normalizeSelectionTheme } from "./selectionTheme";

describe("PageViewer", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(callback, 0));
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        lineTo: vi.fn(),
        moveTo: vi.fn(),
        restore: vi.fn(),
        save: vi.fn(),
        setTransform: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
      })),
    });
  });

  it("maps pointer selection through metadata page dimensions", () => {
    const metadata = new MetadataHelper();
    metadata.load({
      pages: [
        {
          pageNumber: 1,
          width: 200,
          height: 400,
          tokens: [
            {
              content: "ALPHA",
              confidence: 0.92,
              polygon: [100, 200, 120, 200, 120, 240, 100, 240],
            },
          ],
          contexts: [],
          figures: [],
        },
      ],
    });
    const getElement = vi.spyOn(metadata, "getElement");
    const viewer = new PageViewer({
      metadata,
      selection: new SelectionManager(normalizeSelectionTheme()),
      onChange: () => {},
      onCoordinates: () => {},
    });

    viewer.show({
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageNumber: 1,
      pageCount: 1,
      width: 100,
      height: 200,
      url: "blob:page",
    });
    const image = viewer.element().querySelector("img")!;
    const canvas = viewer.element().querySelector("canvas")!;
    Object.defineProperty(image, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 200,
        right: 100,
        bottom: 200,
      }),
    });

    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 100 }));

    expect(getElement).toHaveBeenCalledWith(0, 100, 200);
  });

  it("ignores pointer selection when page metadata is absent", () => {
    const metadata = new MetadataHelper();
    const getElement = vi.spyOn(metadata, "getElement");
    const viewer = new PageViewer({
      metadata,
      selection: new SelectionManager(normalizeSelectionTheme()),
      onChange: () => {},
      onCoordinates: () => {},
    });

    viewer.show({
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageNumber: 1,
      pageCount: 1,
      width: 100,
      height: 200,
      url: "blob:page",
    });
    const image = viewer.element().querySelector("img")!;
    const canvas = viewer.element().querySelector("canvas")!;
    Object.defineProperty(image, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 200,
        right: 100,
        bottom: 200,
      }),
    });

    expect(() => canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: 50, clientY: 100 }))).not.toThrow();
    expect(getElement).not.toHaveBeenCalled();
  });
});
