import type { ThumbnailPage } from "./types";

interface ThumbnailViewerOptions {
  onRange: (pageIndexes: number[]) => void;
  onSelect: (pageIndex: number) => void;
}

interface PageSize {
  width: number;
  height: number;
}

const styleId = "aurora-lens-thumbnail-style";

export class ThumbnailViewer {
  private readonly root = document.createElement("div");
  private pages: Array<ThumbnailPage | undefined> = [];
  private metadataPages = new Set<number>();
  private activeIndex = -1;
  private pageCount = 0;
  private pageSize: PageSize = { width: 1, height: 1 };
  private sourceName = "";
  private frame = 0;

  constructor(private readonly options: ThumbnailViewerOptions) {
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = "@keyframes aurora-lens-thumbnail-sheen { 0% { transform: translateX(-135%) rotate(8deg); opacity: 0; } 18% { opacity: 0.92; } 55% { opacity: 0.7; } 100% { transform: translateX(135%) rotate(8deg); opacity: 0; } }";
      document.head.append(style);
    }
    this.root.addEventListener("scroll", () => this.emitRange());
  }

  element() {
    return this.root;
  }

  thumbnailSize() {
    const probe = document.createElement("div");
    probe.style.width = "27.34375rem";
    document.body.appendChild(probe);
    const size = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    return size;
  }

  show(pageCount: number, sourceName: string, pageSize: PageSize, pages: Array<ThumbnailPage | undefined>, activeIndex: number, metadataPages: Set<number>) {
    this.pageCount = pageCount;
    this.sourceName = sourceName;
    this.pageSize = pageSize;
    this.pages = pages;
    this.metadataPages = metadataPages;
    this.activeIndex = activeIndex;
    this.render(true);
  }

  update(pages: Array<ThumbnailPage | undefined>, activeIndex: number, metadataPages: Set<number>) {
    this.pages = pages;
    this.metadataPages = metadataPages;
    this.activeIndex = activeIndex;
    this.render(false);
  }

  clear() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.root.innerHTML = "";
    this.pages = [];
    this.metadataPages = new Set();
    this.activeIndex = -1;
    this.pageCount = 0;
    this.sourceName = "";
    this.pageSize = { width: 1, height: 1 };
  }

  private render(focusActive: boolean) {
    const scrollTop = this.root.scrollTop;
    this.root.innerHTML = "";
    Object.assign(this.root.style, {
      display: "grid",
      position: "absolute",
      inset: "0",
      gridTemplateColumns: "repeat(auto-fill, minmax(13.75rem, 21.5625rem))",
      gridTemplateRows: "none",
      gridAutoRows: "max-content",
      gap: "0.75rem",
      justifyContent: "center",
      alignContent: "start",
      alignItems: "start",
      width: "100%",
      height: "100%",
      minWidth: "0",
      minHeight: "0",
      margin: "0",
      padding: "0.875rem",
      border: "0",
      borderRadius: "0.5rem",
      boxShadow: "none",
      background: "transparent",
      overflow: "auto",
      boxSizing: "border-box",
    });
    for (let index = 0; index < this.pageCount; index += 1) {
      this.root.appendChild(this.button(index));
    }
    if (focusActive) {
      const active = this.root.children[this.activeIndex];
      if (active instanceof HTMLElement) {
        active.focus();
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } else {
      this.root.scrollTop = scrollTop;
    }
    if (this.frame) {
      cancelAnimationFrame(this.frame);
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.emitRange();
    });
  }

  private button(index: number) {
    const page = this.pages[index];
    const pageNumber = index + 1;
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => this.options.onSelect(index));
    button.addEventListener("pointerenter", () => this.hover(button, true));
    button.addEventListener("pointerleave", () => this.hover(button, false));

    const image = page ? document.createElement("img") : document.createElement("div");
    if (page && image instanceof HTMLImageElement) {
      image.src = page.url;
      image.alt = `${page.sourceName} page ${page.pageNumber}`;
    } else {
      image.setAttribute("aria-label", `${this.sourceName} page ${pageNumber} thumbnail loading`);
      const sheen = document.createElement("span");
      sheen.setAttribute("aria-hidden", "true");
      Object.assign(sheen.style, {
        position: "absolute",
        inset: "-20% auto -20% 0",
        width: "42%",
        borderRadius: "999px",
        background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(214,226,234,0.62) 42%, rgba(255,255,255,0.9) 50%, rgba(214,226,234,0.48) 58%, rgba(255,255,255,0) 100%)",
        filter: "blur(0.375rem)",
        animation: "aurora-lens-thumbnail-sheen 1.45s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      });
      image.append(sheen);
    }

    const title = document.createElement("div");
    const pageText = document.createElement("span");
    pageText.textContent = `Page ${pageNumber}`;
    const sizeText = document.createElement("span");
    sizeText.textContent = page ? `${page.width}x${page.height}` : "Loading";
    title.append(pageText, sizeText);

    button.append(image, title);
    const badge = this.metadataPages.has(index) ? this.badge(pageNumber) : null;
    if (badge) {
      button.append(badge);
    }
    this.styleButton(button, image, title, badge, index, page);
    return button;
  }

  private badge(pageNumber: number) {
    const badge = document.createElement("span");
    badge.textContent = "Intelligence";
    badge.setAttribute("aria-label", `Intelligence ready for page ${pageNumber}`);
    return badge;
  }

  private styleButton(button: HTMLButtonElement, image: HTMLElement, title: HTMLDivElement, badge: HTMLSpanElement | null, index: number, page: ThumbnailPage | undefined) {
    const active = index === this.activeIndex;
    if (active) {
      button.setAttribute("aria-current", "page");
    }
    Object.assign(button.style, {
      display: "grid",
      position: "relative",
      gap: "0.5rem",
      alignContent: "start",
      minWidth: "0",
      width: "100%",
      maxWidth: "21.5625rem",
      height: "auto",
      border: `1px solid ${active ? "#005168" : "#d6dce2"}`,
      borderRadius: "0.375rem",
      padding: "0.5rem",
      color: "#1f2937",
      background: "#ffffff",
      boxShadow: "none",
      cursor: "pointer",
      textAlign: "left",
      transform: "translateY(0)",
      transition: "transform 140ms ease-out, box-shadow 140ms ease-out",
      boxSizing: "border-box",
    });
    Object.assign(image.style, {
      display: page ? "block" : "grid",
      width: "100%",
      height: "auto",
      maxHeight: "27.34375rem",
      aspectRatio: page ? `${page.width} / ${page.height}` : `${this.pageSize.width} / ${this.pageSize.height}`,
      position: page ? "static" : "relative",
      padding: "0",
      objectFit: "contain",
      border: "0",
      background: page ? "#ffffff" : "radial-gradient(circle at 50% 35%, #ffffff 0%, #ffffff 54%, #f5f8fa 100%)",
      boxShadow: page ? "none" : "inset 0 0 0 1px #dce5eb, inset 0 0 2.75rem rgba(0, 81, 104, 0.055)",
      boxSizing: "border-box",
      overflow: "hidden",
    });
    Object.assign(title.style, {
      display: "flex",
      justifyContent: "space-between",
      gap: "0.5rem",
      color: "#005168",
      fontWeight: "700",
      fontSize: "0.75rem",
    });
    if (badge) {
      Object.assign(badge.style, {
        position: "absolute",
        top: "0.75rem",
        right: "0.75rem",
        border: "1px solid #b7d6ff",
        borderRadius: "999px",
        padding: "0.125rem 0.375rem",
        color: "#2253a3",
        background: "#edf6ff",
        fontSize: "0.6875rem",
        fontWeight: "800",
        lineHeight: "1.2",
        boxShadow: "0 1px 4px rgba(17, 24, 39, 0.12)",
      });
    }
  }

  private emitRange() {
    if (!this.pageCount) {
      return;
    }
    const indexes = this.visibleIndexes();
    this.options.onRange(indexes);
  }

  private visibleIndexes() {
    const visible: number[] = [];
    const top = this.root.scrollTop;
    const bottom = top + this.root.clientHeight;
    Array.from(this.root.children).forEach((child, index) => {
      if (!(child instanceof HTMLElement)) {
        return;
      }
      const childTop = child.offsetTop;
      const childBottom = childTop + child.offsetHeight;
      if (childBottom >= top && childTop <= bottom) {
        visible.push(index);
      }
    });
    if (!visible.length) {
      visible.push(Math.max(0, this.activeIndex));
    }
    const first = Math.max(0, visible[0] - 6);
    const last = Math.min(this.pageCount - 1, visible[visible.length - 1] + 6);
    const indexes: number[] = [];
    for (let index = first; index <= last && indexes.length < 20; index += 1) {
      indexes.push(index);
    }
    return indexes;
  }

  private hover(button: HTMLButtonElement, active: boolean) {
    Object.assign(button.style, {
      transform: active ? "translateY(-2px)" : "translateY(0)",
      boxShadow: active ? "0 4px 12px rgba(17, 24, 39, 0.16)" : "none",
    });
  }
}
