import { afterEach, describe, expect, it, vi } from "vitest";
import { readRasterImage } from "./rasterImage";

afterEach(() => vi.unstubAllGlobals());

describe("raster image resources", () => {
  it.each([false, true])("releases the bitmap and canvas after reading pixels (failure: %s)", async fail => {
    const close = vi.fn();
    const pixels = new Uint8ClampedArray([1, 2, 3, 255]);
    let canvas!: { width: number; height: number };
    vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close }));
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) { canvas = this; }
      getContext() {
        return {
          drawImage() { if (fail) throw new Error("image failed"); },
          getImageData: () => ({ data: pixels }),
        };
      }
    });
    const read = readRasterImage(new Blob(["image"]));
    if (fail) await expect(read).rejects.toThrow("image failed");
    else await expect(read).resolves.toEqual({ width: 1, height: 1, pixels });
    expect(close).toHaveBeenCalledOnce();
    expect(canvas).toEqual({ width: 0, height: 0 });
  });
});
