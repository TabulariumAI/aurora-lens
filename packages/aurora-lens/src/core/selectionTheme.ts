import type { PartialSelectionTheme, SelectionColor, SelectionTheme } from "./types";

export const defaultSelectionTheme: SelectionTheme = {
  context: {
    fill: "rgba(255, 230, 128, 0.25)",
    stroke: "rgba(183, 121, 31, 0.72)",
  },
  figure: {
    fill: "rgba(0, 0, 128, 0.12)",
    stroke: "navy",
  },
  token: {
    high: {
      fill: "rgba(0, 81, 104, 0.12)",
      stroke: "#005168",
    },
    medium: {
      fill: "rgba(183, 121, 31, 0.16)",
      stroke: "#B7791F",
    },
    low: {
      fill: "rgba(180, 35, 24, 0.12)",
      stroke: "#B42318",
    },
  },
  confidence: {
    high: 95,
    medium: 80,
  },
};

export function normalizeSelectionTheme(theme?: PartialSelectionTheme): SelectionTheme {
  return {
    context: mergeColor(defaultSelectionTheme.context, theme?.context),
    figure: mergeColor(defaultSelectionTheme.figure, theme?.figure),
    token: {
      high: mergeColor(defaultSelectionTheme.token.high, theme?.token?.high),
      medium: mergeColor(defaultSelectionTheme.token.medium, theme?.token?.medium),
      low: mergeColor(defaultSelectionTheme.token.low, theme?.token?.low),
    },
    confidence: {
      high: theme?.confidence?.high ?? defaultSelectionTheme.confidence.high,
      medium: theme?.confidence?.medium ?? defaultSelectionTheme.confidence.medium,
    },
  };
}

export function tokenStyle(confidence: string, theme: SelectionTheme): SelectionColor {
  const value = Number.parseInt(confidence, 10);
  if (value >= theme.confidence.high) {
    return theme.token.high;
  }
  if (value >= theme.confidence.medium) {
    return theme.token.medium;
  }
  return theme.token.low;
}

function mergeColor(defaults: SelectionColor, color?: Partial<SelectionColor>): SelectionColor {
  return {
    fill: color?.fill ?? defaults.fill,
    stroke: color?.stroke ?? defaults.stroke,
  };
}
