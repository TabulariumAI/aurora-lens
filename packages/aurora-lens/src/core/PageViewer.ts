import { pageRect, screenToDisplay, screenToPage } from "./coordinates";
import { MetadataHelper } from "./MetadataHelper";
import { SelectionManager } from "./SelectionManager";
import type { DecodedPage, PagePoint } from "./types";

interface PageViewerOptions {
  metadata: MetadataHelper;
  selection: SelectionManager;
  onChange: () => void;
  onCoordinates: (coordinates: PagePoint | null, displayCoordinates: PagePoint | null) => void;
}

type PointerMode = "click" | "draw" | "pan" | null;

export class PageViewer {
  private readonly root = document.createElement("div");
  private readonly frame = document.createElement("div");
  private readonly image = document.createElement("img");
  private readonly canvas = document.createElement("canvas");
  private page: DecodedPage | null = null;
  private zoom = 1;
  private move = { x: 0, y: 0 };
  private currentPointer: PagePoint | null = null;
  private pointerMoved = false;
  private lastPointer = { x: 0, y: 0 };
  private drawMode = false;
  private mode: PointerMode = null;
  private startImage: PagePoint | null = null;
  private startScreen: PagePoint | null = null;
  private draftRect: { x: number; y: number; width: number; height: number } | null = null;
  private rectangles: Array<{ x: number; y: number; width: number; height: number }> = [];
  private renderRequested = false;

  constructor(private readonly options: PageViewerOptions) {
    this.root.appendChild(this.frame);
    this.frame.append(this.image, this.canvas);
    this.style();
    this.bind();
  }

  element() {
    return this.root;
  }

  getZoom() {
    return this.zoom;
  }

  getDrawMode() {
    return this.drawMode;
  }

  hasPage() {
    return Boolean(this.page);
  }

  canZoomIn() {
    return Boolean(this.page) && this.zoom < 8;
  }

  canZoomOut() {
    return Boolean(this.page) && this.zoom > this.bestFitZoom();
  }

  show(page: DecodedPage) {
    this.page = page;
    this.currentPointer = null;
    this.clearRects();
    this.image.src = page.url;
    this.image.alt = `${page.sourceName} page ${page.pageNumber}`;
    this.image.hidden = false;
    this.canvas.hidden = false;
    this.fitPage();
    this.options.onCoordinates(null, null);
  }

  clear() {
    this.page = null;
    this.currentPointer = null;
    this.clearRects();
    this.image.removeAttribute("src");
    this.image.alt = "";
    this.image.hidden = true;
    this.canvas.hidden = true;
    this.options.selection.clear();
    this.options.onCoordinates(null, null);
    this.options.onChange();
    this.schedule();
  }

  fitPage() {
    if (!this.page) {
      return;
    }
    this.zoom = this.bestFitZoom();
    this.move = { x: 0, y: 0 };
    this.applyTransform();
  }

  fitWidth() {
    if (!this.page) {
      return;
    }
    this.zoom = Math.max(this.bestFitZoom(), Math.min(8, this.fitSize().width / this.page.width));
    this.move = { x: 0, y: 0 };
    this.applyTransform();
  }

  fitHeight() {
    if (!this.page) {
      return;
    }
    this.zoom = Math.max(this.bestFitZoom(), Math.min(8, this.fitSize().height / this.page.height));
    this.move = { x: 0, y: 0 };
    this.applyTransform();
  }

  actualSize() {
    if (!this.page) {
      return;
    }
    this.zoom = Math.max(this.bestFitZoom(), 1);
    this.move = { x: 0, y: 0 };
    this.applyTransform();
  }

  zoomIn() {
    this.changeZoom(1.2, this.zoomCenter());
  }

  zoomOut() {
    this.changeZoom(1 / 1.2, this.zoomCenter());
  }

  setDrawMode(enabled: boolean) {
    this.clearRects();
    this.drawMode = enabled;
    this.syncCursor();
    this.options.onChange();
    this.schedule();
  }

  clearSelection() {
    this.options.selection.clear();
    this.clearRects();
    this.options.onChange();
    this.schedule();
  }

  render() {
    this.schedule();
  }

  private style() {
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      minWidth: "0",
      minHeight: "0",
      overflow: "hidden",
    });
    Object.assign(this.frame.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      background: "#ffffff",
    });
    Object.assign(this.image.style, {
      position: "absolute",
      display: "block",
      maxWidth: "none",
      objectFit: "contain",
      transformOrigin: "top left",
      userSelect: "none",
      transform: "none",
    });
    this.image.draggable = false;
    this.image.hidden = true;
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      touchAction: "none",
    });
    this.canvas.hidden = true;
  }

  private bind() {
    this.frame.addEventListener("contextmenu", (event) => event.preventDefault());
    this.frame.addEventListener(
      "wheel",
      (event) => {
        if (!this.page) {
          return;
        }
        event.preventDefault();
        this.currentPointer = { x: event.clientX, y: event.clientY };
        this.changeZoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, this.currentPointer);
        this.updateCoordinates(event.clientX, event.clientY);
      },
      { passive: false }
    );
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", () => this.cancelPointer());
    this.canvas.addEventListener("dblclick", (event) => this.onDoubleClick(event));
    this.canvas.addEventListener("pointerleave", () => {
      this.currentPointer = null;
    });
    this.image.addEventListener("load", () => this.schedule());
    window.addEventListener("resize", () => {
      if (!this.page) {
        return;
      }
      this.applyTransform();
    });
  }

  private fitSize() {
    const rect = this.frame.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  }

  private bestFitZoom() {
    if (!this.page) {
      return 1;
    }
    const size = this.fitSize();
    return Math.min(8, Math.min(size.width / this.page.width, size.height / this.page.height));
  }

  private applyTransform() {
    if (this.page) {
      const frame = this.frame.getBoundingClientRect();
      const width = this.page.width * this.zoom;
      const height = this.page.height * this.zoom;
      this.image.style.left = `${(frame.width - width) / 2 + this.move.x}px`;
      this.image.style.top = `${(frame.height - height) / 2 + this.move.y}px`;
      this.image.style.width = `${width}px`;
      this.image.style.height = `${height}px`;
    }
    this.image.style.transform = "none";
    this.syncCursor();
    this.options.onChange();
    this.schedule();
  }

  private changeZoom(multiplier: number, center: PagePoint | null) {
    if (!this.page) {
      return;
    }
    const oldZoom = this.zoom;
    const nextZoom = Math.max(this.bestFitZoom(), Math.min(8, this.zoom * multiplier));
    if (nextZoom === oldZoom) {
      return;
    }
    if (center) {
      const frame = this.frame.getBoundingClientRect();
      const rect = this.image.getBoundingClientRect();
      const imageX = (center.x - rect.left) / oldZoom;
      const imageY = (center.y - rect.top) / oldZoom;
      const nextWidth = this.page.width * nextZoom;
      const nextHeight = this.page.height * nextZoom;
      const baseLeft = (frame.width - nextWidth) / 2;
      const baseTop = (frame.height - nextHeight) / 2;
      this.move.x = center.x - frame.left - baseLeft - imageX * nextZoom;
      this.move.y = center.y - frame.top - baseTop - imageY * nextZoom;
    }
    this.zoom = nextZoom;
    this.applyTransform();
  }

  private zoomCenter() {
    if (this.currentPointer) {
      return this.currentPointer;
    }
    const rect = this.image.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  private canPan() {
    if (!this.page || this.image.hidden || this.zoom <= this.bestFitZoom()) {
      return false;
    }
    const frame = this.frame.getBoundingClientRect();
    const imageWidth = Number.parseFloat(this.image.style.width) || this.image.getBoundingClientRect().width;
    const imageHeight = Number.parseFloat(this.image.style.height) || this.image.getBoundingClientRect().height;
    return imageWidth > frame.width || imageHeight > frame.height;
  }

  private onPointerDown(event: PointerEvent) {
    if (!this.page) {
      return;
    }
    const size = this.pageSize(this.page);
    const point = this.screenPoint(event.clientX, event.clientY, true);
    if (!point) {
      this.options.onCoordinates(null, null);
      return;
    }
    this.startImage = point;
    this.startScreen = { x: event.clientX, y: event.clientY };
    this.currentPointer = { x: event.clientX, y: event.clientY };
    this.pointerMoved = false;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    if (this.drawMode) {
      this.mode = "draw";
      this.draftRect = pageRect(point, point, size.width, size.height);
      this.schedule();
    } else if (this.canPan()) {
      this.mode = "pan";
      this.canvas.style.cursor = "grabbing";
    } else {
      this.mode = "click";
    }
    this.canvas.setPointerCapture(event.pointerId);
  }

  private onPointerMove(event: PointerEvent) {
    this.currentPointer = { x: event.clientX, y: event.clientY };
    this.updateCoordinates(event.clientX, event.clientY);
    if (!this.mode || !this.startScreen || !this.startImage || !this.page) {
      return;
    }
    const dx = Math.abs(event.clientX - this.startScreen.x);
    const dy = Math.abs(event.clientY - this.startScreen.y);
    this.pointerMoved = this.pointerMoved || dx > 2 || dy > 2;
    if (this.mode === "draw") {
      const size = this.pageSize(this.page);
      const point = this.screenPoint(event.clientX, event.clientY, false)!;
      this.draftRect = pageRect(this.startImage, point, size.width, size.height);
      this.schedule();
    } else if (this.mode === "pan") {
      this.move.x += event.clientX - this.lastPointer.x;
      this.move.y += event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.applyTransform();
    }
  }

  private onPointerUp(event: PointerEvent) {
    const wasClick = !this.pointerMoved;
    this.pointerMoved = false;
    if (this.mode === "draw" && this.startImage && this.page) {
      const size = this.pageSize(this.page);
      const point = this.screenPoint(event.clientX, event.clientY, false)!;
      const rect = pageRect(this.startImage, point, size.width, size.height);
      if (rect.width > 1 && rect.height > 1 && this.hasMetadataPage()) {
        const hits = this.options.metadata.getElements(this.page.pageIndex, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
        if (hits.tokens.length || hits.figures.length) {
          if (event.ctrlKey) {
            this.options.selection.showElements(hits);
          } else {
            this.options.selection.showElement(hits);
          }
        }
        this.rectangles = [];
      } else {
        this.updateCoordinates(event.clientX, event.clientY);
      }
      this.draftRect = null;
      this.schedule();
    } else if (wasClick) {
      this.updateCoordinates(event.clientX, event.clientY);
    }
    this.mode = null;
    this.startImage = null;
    this.startScreen = null;
    this.syncCursor();
    this.options.onChange();
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  }

  private cancelPointer() {
    this.pointerMoved = false;
    this.mode = null;
    this.startImage = null;
    this.startScreen = null;
    this.draftRect = null;
    this.currentPointer = null;
    this.syncCursor();
    this.options.onChange();
    this.schedule();
  }

  private clearRects() {
    this.rectangles = [];
    this.draftRect = null;
  }

  private screenPoint(clientX: number, clientY: number, requireInside: boolean) {
    if (!this.page) {
      return null;
    }
    const size = this.pageSize(this.page);
    return screenToPage(clientX, clientY, this.image.getBoundingClientRect(), size.width, size.height, requireInside);
  }

  private displayPoint(clientX: number, clientY: number, requireInside: boolean) {
    return screenToDisplay(clientX, clientY, this.image.getBoundingClientRect(), requireInside);
  }

  private schedule() {
    if (this.renderRequested) {
      return;
    }
    this.renderRequested = true;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      this.renderAnnotations();
    });
  }

  private renderAnnotations() {
    const context = this.canvas.getContext("2d");
    if (!context) {
      return;
    }
    const frame = this.frame.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(frame.width));
    const height = Math.max(1, Math.round(frame.height));
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!this.page || this.image.hidden) {
      return;
    }
    const image = this.image.getBoundingClientRect();
    const rects = this.rectangles.slice();
    if (this.draftRect) {
      rects.push(this.draftRect);
    }
    context.fillStyle = "rgba(0, 151, 169, 0.12)";
    context.strokeStyle = "rgba(0, 81, 104, 0.72)";
    context.lineWidth = 1;
    const size = this.pageSize(this.page);
    rects.forEach((rect) => {
      if (rect.width <= 0 || rect.height <= 0 || !this.page) {
        return;
      }
      const x = image.left + (rect.x / size.width) * image.width - frame.left;
      const y = image.top + (rect.y / size.height) * image.height - frame.top;
      const w = (rect.width / size.width) * image.width;
      const h = (rect.height / size.height) * image.height;
      context.fillRect(x, y, w, h);
      context.strokeRect(x, y, w, h);
    });
    this.options.selection.draw(context, size, image, frame);
  }

  private updateCoordinates(clientX: number, clientY: number) {
    this.options.onCoordinates(this.screenPoint(clientX, clientY, true), this.displayPoint(clientX, clientY, true));
  }

  private onDoubleClick(event: MouseEvent) {
    if (!this.page) {
      return;
    }
    const point = this.screenPoint(event.clientX, event.clientY, true);
    this.clearRects();
    if (point) {
      const command = event.ctrlKey
        ? this.options.selection.clearElement(point)
        : {
            type: "load" as const,
            point,
          };
      if (command.type === "load") {
        if (this.hasMetadataPage()) {
          const hits = this.options.metadata.getElement(this.page.pageIndex, command.point.x, command.point.y);
          if (hits.tokens.length || hits.figures.length) {
            if (event.ctrlKey) {
              this.options.selection.showElements(hits);
            } else {
              this.options.selection.showElement(hits);
            }
          }
        }
      }
      this.updateCoordinates(event.clientX, event.clientY);
    } else {
      this.options.onCoordinates(null, null);
    }
    this.options.onChange();
    this.schedule();
  }

  private pageSize(page: DecodedPage) {
    return this.options.metadata.hasPage(page.pageIndex) ? this.options.metadata.pageSize(page.pageIndex) : page;
  }

  private hasMetadataPage() {
    return Boolean(this.page && this.options.metadata.hasPage(this.page.pageIndex));
  }

  private syncCursor() {
    this.canvas.style.cursor = this.drawMode ? "crosshair" : this.canPan() ? "grab" : "default";
  }
}
