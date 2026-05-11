import type { SelectionTheme } from "@tabularium/aurora-lens";

export const selectionTheme = {
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
} satisfies SelectionTheme;
