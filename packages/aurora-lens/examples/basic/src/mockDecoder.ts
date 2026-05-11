import type { AuroraLensDecoder, RasterPage } from "@tabularium/aurora-lens";

const pageCount = 2;

export class MockDecoder implements AuroraLensDecoder {
  async decode(file: File, pageIndex: number): Promise<RasterPage> {
    return createPage(file.name, pageIndex, 960, 1240);
  }

  async thumbnail(file: File, pageIndex: number, maxSize: number): Promise<RasterPage> {
    return createPage(file.name, pageIndex, maxSize, Math.round(maxSize * 1.29));
  }
}

function createPage(sourceName: string, pageIndex: number, width: number, height: number): RasterPage {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const accent = pageIndex === 0 ? [0, 81, 104] : [183, 121, 31];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const stripe = Math.floor((x + y) / 42) % 2;
      const shade = stripe ? 246 : 255;
      pixels[offset] = shade;
      pixels[offset + 1] = shade;
      pixels[offset + 2] = shade;
      pixels[offset + 3] = 255;
    }
  }

  drawBand(pixels, width, 96, 104, width - 192, 72, accent);
  drawBand(pixels, width, 96, 260, width - 300, 22, [40, 48, 56]);
  drawBand(pixels, width, 96, 320, width - 220, 18, [96, 108, 118]);
  drawBand(pixels, width, 96, 380, width - 360, 18, [96, 108, 118]);
  drawBand(pixels, width, 96, 560, width - 192, 2, [180, 188, 196]);
  drawBand(pixels, width, 96, 640, 240, 140, [225, 232, 236]);
  drawBand(pixels, width, 392, 640, width - 488, 22, [96, 108, 118]);
  drawBand(pixels, width, 392, 700, width - 560, 18, [96, 108, 118]);

  return {
    sourceName,
    pageIndex,
    pageNumber: pageIndex + 1,
    pageCount,
    width,
    height,
    pixels,
  };
}

function drawBand(
  pixels: Uint8ClampedArray,
  pageWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
  color: number[]
) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * pageWidth + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
}
