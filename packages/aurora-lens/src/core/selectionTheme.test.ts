import { describe, expect, it } from "vitest";
import { SelectionManager } from "./SelectionManager";
import { defaultSelectionTheme, normalizeSelectionTheme, tokenStyle } from "./selectionTheme";
import type { PageMetadataHits } from "./types";

describe("selectionTheme", () => {
  it("uses default token styles at default confidence thresholds", () => {
    const theme = normalizeSelectionTheme();

    expect(tokenStyle("95%", theme)).toEqual(defaultSelectionTheme.token.high);
    expect(tokenStyle("80%", theme)).toEqual(defaultSelectionTheme.token.medium);
    expect(tokenStyle("79%", theme)).toEqual(defaultSelectionTheme.token.low);
  });

  it("keeps default colors when host overrides are partial", () => {
    const theme = normalizeSelectionTheme({
      context: {
        fill: "context-fill",
      },
      token: {
        high: {
          stroke: "high-stroke",
        },
      },
      confidence: {
        high: 90,
      },
    });

    expect(theme.context).toEqual({
      fill: "context-fill",
      stroke: defaultSelectionTheme.context.stroke,
    });
    expect(theme.token.high).toEqual({
      fill: defaultSelectionTheme.token.high.fill,
      stroke: "high-stroke",
    });
    expect(theme.confidence).toEqual({
      high: 90,
      medium: defaultSelectionTheme.confidence.medium,
    });
  });

  it("draws selected elements with host-provided colors", () => {
    const theme = normalizeSelectionTheme({
      context: {
        fill: "context-fill",
        stroke: "context-stroke",
      },
      figure: {
        fill: "figure-fill",
        stroke: "figure-stroke",
      },
      token: {
        high: {
          fill: "token-fill",
          stroke: "token-stroke",
        },
      },
      confidence: {
        high: 90,
      },
    });
    const manager = new SelectionManager(theme);
    const recorder = recordingContext();

    manager.showElement(hits());
    manager.draw(
      recorder.context,
      { width: 100, height: 100 },
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 0, top: 0, width: 100, height: 100 }
    );

    expect(recorder.fills).toContain("context-fill");
    expect(recorder.fills).toContain("figure-fill");
    expect(recorder.fills).toContain("token-fill");
    expect(recorder.strokes).toContain("context-stroke");
    expect(recorder.strokes).toContain("figure-stroke");
    expect(recorder.strokes).toContain("token-stroke");
  });

  it("draws metadata polygons in metadata page coordinates", () => {
    document.documentElement.style.fontSize = "16px";
    const manager = new SelectionManager(normalizeSelectionTheme());
    const recorder = recordingContext();

    manager.showElement({
      tokens: [
        {
          token: "ALPHA",
          confidence: "92%",
          polygon: [1000, 1000, 1200, 1000, 1200, 1400, 1000, 1400],
        },
      ],
      contexts: [],
      figures: [],
    });
    manager.draw(
      recorder.context,
      { width: 2000, height: 2000 },
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 0, top: 0, width: 100, height: 100 }
    );

    expect(recorder.moves).toContainEqual({ x: 44.4, y: 44.4 });
    expect(recorder.lines).toContainEqual({ x: 65.6, y: 44.4 });
    expect(recorder.lines).toContainEqual({ x: 65.6, y: 75.6 });
    expect(recorder.lines).toContainEqual({ x: 44.4, y: 75.6 });
  });
});

function recordingContext() {
  const fills: string[] = [];
  const strokes: string[] = [];
  const moves: Array<{ x: number; y: number }> = [];
  const lines: Array<{ x: number; y: number }> = [];
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo(x: number, y: number) {
      moves.push({ x, y });
    },
    lineTo(x: number, y: number) {
      lines.push({ x, y });
    },
    fill() {},
    stroke() {},
    set fillStyle(value: string) {
      fills.push(value);
    },
    get fillStyle() {
      return "";
    },
    set strokeStyle(value: string) {
      strokes.push(value);
    },
    get strokeStyle() {
      return "";
    },
    set globalCompositeOperation(_value: string) {},
    get globalCompositeOperation() {
      return "source-over";
    },
    set lineWidth(_value: number) {},
    get lineWidth() {
      return 1;
    },
  } as unknown as CanvasRenderingContext2D;
  return {
    context,
    fills,
    lines,
    moves,
    strokes,
  };
}

function hits(): PageMetadataHits {
  return {
    tokens: [
      {
        token: "ALPHA",
        confidence: "92%",
        polygon: [10, 10, 40, 10, 40, 30, 10, 30],
      },
    ],
    contexts: [
      {
        content: "ALPHA",
        role: "body",
        polygon: [5, 5, 45, 5, 45, 35, 5, 35],
      },
    ],
    figures: [
      {
        polygon: [50, 50, 80, 50, 80, 80, 50, 80],
      },
    ],
  };
}
