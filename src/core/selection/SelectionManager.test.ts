import { expect, it } from "vitest";
import { SelectionManager } from "./SelectionManager";
import { normalizeSelectionTheme } from "./selectionTheme";

const context = { content: "Alpha Beta", polygon: [0, 0, 100, 0, 100, 40, 0, 40] };
const alpha = { tokens: [{ token: "Alpha", confidence: "99%", polygon: [10, 10, 40, 10, 40, 30, 10, 30] }], contexts: [context], figures: [] };
const beta = { tokens: [{ token: "Beta", confidence: "99%", polygon: [50, 10, 80, 10, 80, 30, 50, 30] }], contexts: [context], figures: [] };

it("toggles tokens through the existing context reference counts", () => {
  const selection = new SelectionManager(normalizeSelectionTheme());
  selection.toggle(alpha);
  selection.toggle(beta);
  expect(selection.isSelected(alpha)).toBe(true);
  expect(selection.counts()).toEqual({ tokens: 2, context: 1, figures: 0 });
  selection.toggle(alpha);
  expect(selection.isSelected(alpha)).toBe(false);
  expect(selection.isSelected(beta)).toBe(true);
  expect(selection.counts()).toEqual({ tokens: 1, context: 1, figures: 0 });
  selection.toggle(beta);
  expect(selection.counts()).toEqual({ tokens: 0, context: 0, figures: 0 });
});

it("shares selected identity with pointer hits and additive selection", () => {
  const selection = new SelectionManager(normalizeSelectionTheme());
  selection.showElement(alpha);
  expect(selection.isSelected(structuredClone(alpha))).toBe(true);
  selection.toggle(structuredClone(alpha));
  expect(selection.tokens()).toEqual([]);
  selection.showElements(beta);
  selection.showElements(beta);
  selection.toggle(beta);
  expect(selection.counts().context).toBe(0);
});

it("toggles figures without clearing selected text", () => {
  const selection = new SelectionManager(normalizeSelectionTheme());
  const figure = { tokens: [], contexts: [], figures: [{ polygon: [0, 50, 40, 50, 40, 90, 0, 90] }] };
  selection.showElement(alpha);
  selection.toggle(figure);
  expect(selection.isSelected(figure)).toBe(true);
  expect(selection.counts().tokens).toBe(1);
  selection.toggle(figure);
  expect(selection.isSelected(figure)).toBe(false);
  expect(selection.counts().tokens).toBe(1);
});
