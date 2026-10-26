import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataHelper } from "../metadata/MetadataHelper";
import { SelectionManager } from "../selection/SelectionManager";
import { normalizeSelectionTheme } from "../selection/selectionTheme";
import { PageViewer } from "./PageViewer";

const metadataPage = {
  pageNumber: 1, width: 200, height: 400,
  tokens: [
    { content: "Alpha", confidence: 0.99, polygon: [10, 10, 40, 10, 40, 30, 10, 30] },
    { content: "Beta", confidence: 0.99, polygon: [50, 10, 80, 10, 80, 30, 50, 30] },
    { content: "Gamma", confidence: 0.99, polygon: [10, 350, 60, 350, 60, 380, 10, 380] },
  ],
  contexts: [{ content: "Alpha Beta", role: "body", polygon: [0, 0, 100, 0, 100, 40, 0, 40] }],
  figures: [{ polygon: [100, 200, 160, 200, 160, 260, 100, 260] }],
};
const page = { sourceName: "sample.tiff", pageIndex: 0, pageNumber: 1, pageCount: 1, width: 200, height: 400, url: "blob:page" };

function setup(withMetadata = true) {
  const metadata = new MetadataHelper();
  if (withMetadata) metadata.load({ pages: [metadataPage] });
  const selection = new SelectionManager(normalizeSelectionTheme());
  const onChange = vi.fn();
  const viewer = new PageViewer({ metadata, selection, onChange, onCoordinates: vi.fn() });
  const root = viewer.element();
  document.body.append(root);
  const frame = root.querySelector("canvas")!.parentElement!;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 300));
  const image = root.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockImplementation(() => new DOMRect(
    parseFloat(image.style.left), parseFloat(image.style.top), parseFloat(image.style.width), parseFloat(image.style.height),
  ));
  viewer.show(page);
  vi.runOnlyPendingTimers();
  return { viewer, root, frame, metadata, selection, onChange };
}

function press(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  vi.runOnlyPendingTimers();
  return event;
}

describe("PageViewer keyboard selection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      beginPath: vi.fn(), clearRect: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(),
      lineTo: vi.fn(), moveTo: vi.fn(), restore: vi.fn(), save: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("exposes one page tab stop, named selectable items and visible keyboard instructions", () => {
    const { root, frame } = setup();
    expect(frame.getAttribute("role")).toBe("listbox");
    expect(frame.tabIndex).toBe(0);
    expect(frame.getAttribute("aria-multiselectable")).toBe("true");
    expect(frame.getAttribute("aria-label")).toContain("page 1");
    expect([...root.querySelectorAll('[role="option"]')].map(item => item.getAttribute("aria-label"))).toEqual(["Alpha", "Beta", "Gamma", "Figure 1"]);
    expect(root.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(document.getElementById(frame.getAttribute("aria-describedby")!)?.textContent).toContain("Shift+Arrow");
  });

  it("moves focus without changing selection and lets Tab leave", () => {
    const { frame, selection } = setup();
    frame.focus();
    const first = frame.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    expect(press(frame, "ArrowRight").defaultPrevented).toBe(true);
    expect(frame.getAttribute("aria-activedescendant")).not.toBe(first);
    expect(selection.counts().tokens).toBe(0);
    expect(press(frame, "Tab").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(frame);
  });

  it("toggles disjoint text and figure selections without replacing earlier items", () => {
    const { frame, selection } = setup();
    frame.focus();
    press(frame, " ");
    press(frame, "ArrowRight");
    press(frame, "ArrowRight");
    press(frame, "ArrowRight");
    press(frame, " ");
    expect(selection.counts()).toEqual({ tokens: 1, figures: 1, context: 1 });
    expect(frame.querySelectorAll('[aria-selected="true"]')).toHaveLength(2);
    press(frame, " ");
    expect(selection.counts()).toEqual({ tokens: 1, figures: 0, context: 1 });
  });

  it("extends and shrinks a range and exports the same groups as a rectangle", () => {
    const { frame, metadata, selection } = setup();
    frame.focus();
    press(frame, "ArrowRight", true);
    const groups = metadata.exportGroups(0, selection.tokens());
    expect(selection.tokens().map(token => token.token)).toEqual(["Alpha", "Beta"]);
    expect(groups).toEqual(metadata.exportGroups(0, metadata.getElements(0, 0, 0, 90, 35).tokens));
    press(frame, "ArrowRight", true);
    expect(selection.counts().tokens).toBe(3);
    press(frame, "ArrowLeft", true);
    expect(selection.counts().tokens).toBe(2);
    press(frame, "Escape");
    expect(selection.counts().tokens).toBe(2);
    expect(document.activeElement).toBe(frame);
  });

  it("keeps accessible selection state synchronized with pointer selection and clearing", () => {
    const { viewer, root, frame, selection } = setup();
    root.querySelector("canvas")!.dispatchEvent(new MouseEvent("dblclick", { clientX: 90, clientY: 15 }));
    vi.runOnlyPendingTimers();
    expect(selection.tokens().map(token => token.token)).toEqual(["Alpha"]);
    expect(frame.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
    viewer.clearSelection();
    vi.runOnlyPendingTimers();
    expect(frame.querySelectorAll('[aria-selected="true"]')).toHaveLength(0);
  });

  it("continues keyboard navigation from the item selected with the pointer", () => {
    const { root, frame } = setup();
    root.querySelector("canvas")!.dispatchEvent(new MouseEvent("dblclick", { clientX: 120, clientY: 15 }));
    vi.runOnlyPendingTimers();
    const items = frame.querySelectorAll('[role="option"]');
    expect(frame.getAttribute("aria-activedescendant")).toBe(items[1].id);
    press(frame, "ArrowRight");
    expect(frame.getAttribute("aria-activedescendant")).toBe(items[2].id);
  });

  it("does not intercept browser shortcuts or repeatedly toggle held Space", () => {
    const { frame, selection } = setup();
    frame.focus();
    const shortcut = new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, cancelable: true });
    frame.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    frame.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true }));
    expect(selection.counts().tokens).toBe(0);
  });

  it("keeps the active item visible when navigating at a zoomed scale", () => {
    const { viewer, frame } = setup();
    viewer.actualSize();
    frame.focus();
    const active = frame.querySelectorAll<HTMLElement>('[role="option"]')[1];
    vi.spyOn(active, "getBoundingClientRect").mockReturnValue(new DOMRect(-20, 320, 30, 20));
    const image = frame.querySelector("img")!;
    const left = parseFloat(image.style.left);
    const top = parseFloat(image.style.top);
    press(frame, "ArrowRight");
    expect(parseFloat(image.style.left) - left).toBe(24);
    expect(parseFloat(image.style.top) - top).toBe(-44);
  });

  it("does not recenter the image when pointer interaction focuses the page", () => {
    const { frame } = setup();
    vi.spyOn(frame, "matches").mockReturnValue(false);
    const active = frame.querySelector<HTMLElement>('[role="option"]')!;
    vi.spyOn(active, "getBoundingClientRect").mockReturnValue(new DOMRect(-20, 320, 30, 20));
    const image = frame.querySelector("img")!;
    const position = [image.style.left, image.style.top];
    frame.dispatchEvent(new FocusEvent("focus"));
    expect([image.style.left, image.style.top]).toEqual(position);
  });

  it("clamps navigation at the first and last item", () => {
    const { frame } = setup();
    const ids = [...frame.querySelectorAll('[role="option"]')].map(item => item.id);
    frame.focus();
    press(frame, "ArrowLeft");
    expect(frame.getAttribute("aria-activedescendant")).toBe(ids[0]);
    for (let index = 0; index < 5; index++) press(frame, "ArrowDown");
    expect(frame.getAttribute("aria-activedescendant")).toBe(ids.at(-1));
  });

  it("removes unavailable item navigation and instructions on clear or pages without metadata", () => {
    const { viewer, frame, root } = setup(false);
    expect(frame.tabIndex).toBe(-1);
    expect(frame.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(root.querySelector("p")?.hidden).toBe(true);
    viewer.clear();
    expect(frame.hasAttribute("aria-activedescendant")).toBe(false);
    expect(frame.tabIndex).toBe(-1);
  });

  it("resets active items and ids on page change and keeps viewer instances independent", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    const first = setup();
    const second = setup();
    expect(randomUUID).not.toHaveBeenCalled();
    first.frame.focus();
    press(first.frame, "ArrowRight");
    expect(first.frame.getAttribute("aria-describedby")).not.toBe(second.frame.getAttribute("aria-describedby"));
    first.viewer.show(page);
    vi.runOnlyPendingTimers();
    expect(first.frame.getAttribute("aria-activedescendant")).toBe(first.frame.querySelector('[role="option"]')?.id);
    first.viewer.close();
    second.viewer.close();
  });
});
