import type { SelectionColor } from "./types";

interface ThumbnailViewerOptions {
  allowEdit: boolean;
  intelligenceColor: SelectionColor;
  onAdd: (files: File[], insertIndex: number) => Promise<void> | void;
  onRange: (pageIndexes: number[]) => void;
  onReorder: (request: ThumbnailReorderRequest) => Promise<void> | void;
  onRemove: (pageId: string) => Promise<void> | void;
  onSelect: (pageIndex: number) => void;
}

interface PageSize {
  width: number;
  height: number;
}

// pageId is the system-assigned unique page GUID, not the page number.
interface ThumbnailItem {
  kind: "page";
  pageId: string;
  pageIndex: number;
}

interface PendingAdd {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  pageIndex: number;
  side: "left" | "right";
}

interface ThumbnailPage {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  sourceName: string;
  pageIndex: number;
  pageNumber: number;
  pageCount: number;
  width: number;
  height: number;
  url: string;
}

interface ThumbnailReorderRequest {
  fromPageIndex: number;
  toPageIndex: number;
}

const ids = {
  style: "aurora-lens-thumbnail-style",
};

const data = {
  action: "thumbnailAction",
  card: "auroraThumbnailCard",
  dragState: "dragState",
  dropTarget: "dropTarget",
  dragHandle: "thumbnailDragHandle",
  itemId: "itemId",
  media: "thumbnailMedia",
  pageIndex: "pageIndex",
  pageSelect: "pageSelect",
  titlePrimary: "titlePrimary",
  titleSecondary: "titleSecondary",
};

const labels = {
  addAfter: "Add after",
  addBefore: "Add before",
  confirmRemove: "Confirm remove",
  addedLoading: "Added page thumbnail loading",
  addedPage: "Added page",
  loading: "Loading",
  remove: "Remove",
  move: "Move page",
  intelligenceReady: (pageNumber: number) => `Page ${pageNumber} has intelligence metadata`,
  page: (pageNumber: number) => `Page ${pageNumber}`,
  thumbLoading: (sourceName: string, pageNumber: number) => `${sourceName} page ${pageNumber} thumbnail loading`,
};

const messages = {
  add: "Add page complete",
  drop: "Add pages complete",
  remove: "Remove page complete",
  reorder: "Reorder page complete",
};

const layout = {
  activeShadow: "0 4px 12px rgba(17, 24, 39, 0.16)",
  cardMaxWidth: "21.5625rem",
  confirmMs: 3000,
  dragShadow: "0 8px 20px rgba(17, 24, 39, 0.22)",
  imageMaxHeight: "27.34375rem",
  probeWidth: "27.34375rem",
  rangeBuffer: 6,
  rangeLimit: 20,
  scrollEdge: 64,
  scrollMax: 24,
};

const colors = {
  activeBorder: "#005168",
  buttonBorder: "#b7c5cf",
  cardBackground: "#ffffff",
  cardBorder: "#d6dce2",
  placeholderEdge: "#dce5eb",
  removeText: "#b42318",
  tealOverlay: "rgba(0, 81, 104, 0.12)",
  text: "#1f2937",
  title: "#005168",
};

const glyphs = {
  add: "+",
  remove: "×",
};

const styles = {
  root: {
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
    overflowAnchor: "none",
    boxSizing: "border-box",
  },
  hidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: "0",
  },
  card: {
    display: "grid",
    position: "relative",
    gap: "0.5rem",
    alignContent: "start",
    minWidth: "0",
    width: "100%",
    maxWidth: layout.cardMaxWidth,
    height: "auto",
    borderRadius: "0.375rem",
    padding: "0.5rem",
    color: colors.text,
    background: colors.cardBackground,
    boxShadow: "none",
    textAlign: "left",
    transform: "translateY(0)",
    transition: "transform 140ms ease-out, box-shadow 140ms ease-out",
    boxSizing: "border-box",
  },
  media: {
    display: "grid",
    position: "relative",
    width: "100%",
    maxHeight: layout.imageMaxHeight,
    padding: "0",
    border: "0",
    background: colors.cardBackground,
    boxShadow: "none",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    border: "0",
    boxSizing: "border-box",
  },
  placeholder: {
    background: "radial-gradient(circle at 50% 35%, #ffffff 0%, #ffffff 54%, #f5f8fa 100%)",
    boxShadow: `inset 0 0 0 1px ${colors.placeholderEdge}, inset 0 0 2.75rem rgba(0, 81, 104, 0.055)`,
  },
  title: {
    display: "flex",
    justifyContent: "space-between",
    gap: "0.5rem",
    color: colors.title,
    fontWeight: "700",
    fontSize: "0.75rem",
  },
  select: {
    position: "absolute",
    zIndex: "1",
    inset: "0",
    width: "100%",
    height: "100%",
    border: "0",
    padding: "0",
    color: "transparent",
    background: "transparent",
    cursor: "pointer",
  },
  handle: {
    position: "absolute",
    zIndex: "3",
    display: "grid",
    placeItems: "center",
    left: "50%",
    bottom: "0.375rem",
    width: "3.75rem",
    height: "1.75rem",
    border: "0",
    borderRadius: "999px",
    padding: "0",
    color: colors.activeBorder,
    background: colors.tealOverlay,
    fontSize: "1rem",
    fontWeight: "400",
    lineHeight: "1",
    boxShadow: "0 1px 4px rgba(17, 24, 39, 0.16)",
    cursor: "grab",
    transform: "translateX(-50%)",
    transition: "opacity 120ms ease-out",
  },
  action: {
    position: "absolute",
    zIndex: "3",
    display: "grid",
    placeItems: "center",
    width: "3rem",
    height: "3rem",
    border: "0",
    borderRadius: "999px",
    padding: "0",
    color: colors.activeBorder,
    background: colors.tealOverlay,
    fontSize: "1.75rem",
    fontWeight: "400",
    lineHeight: "1",
    boxShadow: "0 1px 4px rgba(17, 24, 39, 0.16)",
    cursor: "pointer",
    transition: "opacity 120ms ease-out",
  },
  armedAction: {
    zIndex: "4",
    width: "auto",
    minWidth: "7rem",
    height: "2rem",
    padding: "0 0.75rem",
    color: "#ffffff",
    background: colors.removeText,
    fontSize: "0.75rem",
    fontWeight: "800",
    lineHeight: "1",
    whiteSpace: "nowrap",
  },
  intelligence: {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: "0",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: "0",
  },
  sheen: {
    position: "absolute",
    inset: "-20% auto -20% 0",
    width: "42%",
    borderRadius: "999px",
    background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(214,226,234,0.62) 42%, rgba(255,255,255,0.9) 50%, rgba(214,226,234,0.48) 58%, rgba(255,255,255,0) 100%)",
    filter: "blur(0.375rem)",
    animation: "aurora-lens-thumbnail-sheen 1.45s cubic-bezier(0.4, 0, 0.2, 1) infinite",
  },
};

const styleText = `
@keyframes aurora-lens-thumbnail-sheen {
  0% { transform: translateX(-135%) rotate(8deg); opacity: 0; }
  18% { opacity: 0.92; }
  55% { opacity: 0.7; }
  100% { transform: translateX(135%) rotate(8deg); opacity: 0; }
}
[data-aurora-thumbnail-card]:hover,
[data-aurora-thumbnail-card]:focus-within {
  box-shadow: ${layout.activeShadow};
  transform: translateY(-2px);
}
[data-aurora-thumbnail-card][data-drag-state="dragging"] {
  box-shadow: ${layout.dragShadow};
  opacity: 0.72;
  transform: scale(0.985);
}
[data-aurora-thumbnail-card][data-drop-target="true"] {
  outline: 2px solid ${colors.activeBorder};
  outline-offset: 0.25rem;
}
[data-aurora-thumbnail-card][data-drag-state="dragging"] [data-thumbnail-drag-handle] {
  cursor: grabbing;
}
[data-page-select] {
  cursor: pointer;
}
[data-thumbnail-drag-handle] {
  cursor: grab;
}
[data-thumbnail-action],
[data-thumbnail-drag-handle] {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}
[data-aurora-thumbnail-card]:hover [data-thumbnail-action],
[data-aurora-thumbnail-card]:focus-within [data-thumbnail-action],
[data-aurora-thumbnail-card]:hover [data-thumbnail-drag-handle],
[data-aurora-thumbnail-card]:focus-within [data-thumbnail-drag-handle] {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}
`;

export class ThumbnailViewer {
  private readonly root = document.createElement("div");
  private readonly fileInput = document.createElement("input");
  private readonly live = document.createElement("span");
  private pages: Array<ThumbnailPage | undefined> = [];
  private pageIds: string[] = [];
  private items: ThumbnailItem[] = [];
  private metadataPages = new Set<string>();
  private activeIndex = -1;
  private pageCount = 0;
  private pageSize: PageSize = { width: 1, height: 1 };
  private sourceName = "";
  private frame = 0;
  private pendingAdd: PendingAdd | null = null;
  private dragItemId = "";
  private dropTargetId = "";
  private armedButton: HTMLButtonElement | null = null;
  private armTimer = 0;
  private scrollFrame = 0;
  private scrollStep = 0;
  private allowEdit: boolean;

  constructor(private readonly options: ThumbnailViewerOptions) {
    this.allowEdit = options.allowEdit;
    this.ensureStyle();
    this.fileInput.type = "file";
    this.fileInput.multiple = true;
    this.fileInput.addEventListener("change", () => this.handleFilePick());
    Object.assign(this.fileInput.style, { display: "none" });
    this.live.setAttribute("aria-live", "polite");
    Object.assign(this.live.style, styles.hidden);
    this.root.addEventListener("scroll", () => this.emitRange());
    this.root.addEventListener("dragover", (event) => {
      if (this.allowEdit && event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        return;
      }
      if (this.allowEdit && this.dragItemId) {
        event.preventDefault();
        this.updateAutoScroll(event);
      }
    });
    this.root.addEventListener("drop", (event) => this.handleDrop(event));
  }

  element() {
    return this.root;
  }

  thumbnailSize() {
    const probe = document.createElement("div");
    probe.style.width = layout.probeWidth;
    document.body.appendChild(probe);
    const size = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    return size;
  }

  setAllowEdit(allowEdit: boolean) {
    if (this.allowEdit === allowEdit) {
      return;
    }
    this.allowEdit = allowEdit;
    this.pendingAdd = null;
    this.clearDrag();
    this.clearArm();
    if (this.pageCount) {
      this.syncEditControls();
    }
  }

  show(pageIds: string[], pageCount: number, sourceName: string, pageSize: PageSize, pages: Array<ThumbnailPage | undefined>, activeIndex: number, metadataPages: Set<string>) {
    this.pageIds = pageIds;
    this.pageCount = pageCount;
    this.sourceName = sourceName;
    this.pageSize = pageSize;
    this.pages = pages;
    this.metadataPages = metadataPages;
    this.activeIndex = activeIndex;
    this.syncItems();
    this.render(true, true);
  }

  update(pageIds: string[], pages: Array<ThumbnailPage | undefined>, activeIndex: number, metadataPages: Set<string>) {
    this.pageIds = pageIds;
    this.pageCount = pageIds.length;
    this.pages = pages;
    this.metadataPages = metadataPages;
    this.activeIndex = activeIndex;
    this.syncItems();
    this.render(false, false);
  }

  clear() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.stopAutoScroll();
    this.root.innerHTML = "";
    this.pages = [];
    this.pageIds = [];
    this.items = [];
    this.metadataPages = new Set();
    this.activeIndex = -1;
    this.pageCount = 0;
    this.sourceName = "";
    this.pageSize = { width: 1, height: 1 };
    this.pendingAdd = null;
    this.dragItemId = "";
    this.dropTargetId = "";
    this.clearArm();
    this.live.textContent = "";
  }

  private ensureStyle() {
    if (!document.getElementById(ids.style)) {
      const style = document.createElement("style");
      style.id = ids.style;
      style.textContent = styleText;
      document.head.append(style);
    }
  }

  private render(focusActive: boolean, emitRange: boolean) {
    const scrollTop = this.root.scrollTop;
    this.root.innerHTML = "";
    Object.assign(this.root.style, styles.root);
    this.items.forEach((item) => {
      this.root.appendChild(this.card(item));
    });
    this.root.append(this.fileInput, this.live);
    if (focusActive) {
      const active = this.root.querySelector(`[data-page-index="${this.activeIndex}"] button[data-page-select="true"]`);
      if (active instanceof HTMLElement) {
        active.focus();
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    } else {
      this.root.scrollTop = scrollTop;
    }
    if (emitRange) {
      if (this.frame) {
        cancelAnimationFrame(this.frame);
      }
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.emitRange();
      });
    }
  }

  private card(item: ThumbnailItem) {
    const card = document.createElement("div");
    const hasMetadata = this.metadataPages.has(item.pageId);
    card.dataset[data.card] = "true";
    Object.assign(card.style, styles.card, {
      border: item.pageIndex === this.activeIndex ? `1px solid ${colors.activeBorder}` : "0",
      borderTop: hasMetadata ? `0.25rem solid ${this.options.intelligenceColor.stroke}` : item.pageIndex === this.activeIndex ? `1px solid ${colors.activeBorder}` : "0",
    });
    card.dataset[data.itemId] = item.pageId;
    card.dataset[data.pageIndex] = String(item.pageIndex);
    card.addEventListener("dragend", () => {
      this.clearDrag();
    });
    card.addEventListener("dragover", (event) => {
      if (this.allowEdit && this.dragItemId) {
        event.preventDefault();
        this.setDropTarget(card.dataset[data.itemId] ?? "");
        this.updateAutoScroll(event);
      }
    });
    card.addEventListener("dragleave", () => {
      if (this.dropTargetId === card.dataset[data.itemId]) {
        this.setDropTarget("");
      }
    });
    card.addEventListener("drop", (event) => this.handleReorder(event, card));
    card.append(this.media(item.pageIndex), this.title(labels.page(item.pageIndex + 1), this.sizeText(item.pageIndex)), this.select(item.pageIndex));
    if (hasMetadata) {
      card.append(this.intelligenceLabel(item.pageIndex + 1));
    }
    if (this.allowEdit) {
      this.addEditControls(card);
    }
    return card;
  }

  private addEditControls(card: HTMLDivElement) {
    const addBefore = this.action(labels.addBefore, glyphs.add, "left");
    const addAfter = this.action(labels.addAfter, glyphs.add, "right");
    const remove = this.action(labels.remove, glyphs.remove, "remove");
    addBefore.addEventListener("click", (event) => this.chooseFile(event, card, "left"));
    addAfter.addEventListener("click", (event) => this.chooseFile(event, card, "right"));
    remove.addEventListener("click", (event) => this.confirmRemove(event, card, remove));
    card.append(this.handle(), addBefore, addAfter, remove);
  }

  private syncEditControls() {
    Array.from(this.root.querySelectorAll("[data-aurora-thumbnail-card]")).forEach((card) => {
      if (!(card instanceof HTMLDivElement) || !card.dataset[data.pageIndex]) {
        return;
      }
      card.querySelectorAll("[data-thumbnail-action], [data-thumbnail-drag-handle]").forEach((control) => control.remove());
      if (this.allowEdit) {
        this.addEditControls(card);
      }
    });
  }

  private media(index: number) {
    const page = this.pages[index];
    const media = this.mediaFrame(page, index + 1);
    if (page) {
      const image = document.createElement("img");
      image.src = page.url;
      image.alt = `${page.sourceName} page ${page.pageNumber}`;
      Object.assign(image.style, styles.image);
      media.append(image);
    } else {
      media.append(this.sheen());
    }
    return media;
  }

  private mediaFrame(page: ThumbnailPage | undefined, pageNumber: number) {
    const media = document.createElement("div");
    media.dataset[data.media] = "true";
    media.setAttribute("aria-label", page ? `${page.sourceName} page ${page.pageNumber}` : labels.thumbLoading(this.sourceName, pageNumber));
    Object.assign(media.style, styles.media, {
      aspectRatio: page ? `${page.width} / ${page.height}` : `${this.pageSize.width} / ${this.pageSize.height}`,
    });
    if (!page) {
      Object.assign(media.style, styles.placeholder);
    }
    return media;
  }

  private sheen() {
    const sheen = document.createElement("span");
    sheen.setAttribute("aria-hidden", "true");
    Object.assign(sheen.style, styles.sheen);
    return sheen;
  }

  private title(primary: string, secondary: string) {
    const title = document.createElement("div");
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.dataset[data.titlePrimary] = "true";
    right.dataset[data.titleSecondary] = "true";
    left.textContent = primary;
    right.textContent = secondary;
    title.append(left, right);
    Object.assign(title.style, styles.title);
    return title;
  }

  private sizeText(index: number) {
    const page = this.pages[index];
    return page ? `${page.width}x${page.height}` : labels.loading;
  }

  private select(index: number) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset[data.pageSelect] = "true";
    button.setAttribute("aria-label", labels.page(index + 1));
    button.addEventListener("click", (event) => {
      const card = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest("[data-page-index]") : null;
      const pageIndex = card instanceof HTMLElement ? Number(card.dataset[data.pageIndex]) : -1;
      if (Number.isInteger(pageIndex) && pageIndex >= 0) {
        this.options.onSelect(pageIndex);
      }
    });
    Object.assign(button.style, styles.select);
    if (index === this.activeIndex) {
      button.setAttribute("aria-current", "page");
    }
    return button;
  }

  private handle() {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = true;
    button.dataset[data.dragHandle] = "true";
    button.textContent = "...";
    button.setAttribute("aria-label", labels.move);
    button.title = labels.move;
    Object.assign(button.style, styles.handle);
    button.addEventListener("dragstart", (event) => {
      const sourceCard = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest("[data-item-id]") : null;
      if (!(sourceCard instanceof HTMLElement)) {
        return;
      }
      this.dragItemId = sourceCard.dataset[data.itemId] ?? "";
      const card = this.root.querySelector(`[data-item-id="${this.dragItemId}"]`);
      if (card instanceof HTMLElement) {
        card.dataset[data.dragState] = "dragging";
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
      event.dataTransfer?.setData("text/plain", this.dragItemId);
      this.updateAutoScroll(event);
    });
    return button;
  }

  private action(label: string, text: string, slot: "left" | "right" | "remove") {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset[data.action] = "true";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.title = label;
    Object.assign(button.style, styles.action);
    if (slot === "left") {
      Object.assign(button.style, { left: "0.375rem", top: "50%", transform: "translateY(-50%)" });
    } else if (slot === "right") {
      Object.assign(button.style, { right: "0.375rem", top: "50%", transform: "translateY(-50%)" });
    } else {
      Object.assign(button.style, { left: "50%", top: "0.375rem", transform: "translateX(-50%)" });
      button.style.color = colors.removeText;
    }
    return button;
  }

  private confirmRemove(event: Event, card: HTMLDivElement, button: HTMLButtonElement) {
    event.stopPropagation();
    if (this.armedButton !== button) {
      this.arm(button);
      return;
    }
    this.clearArm();
    this.removePage(event, card);
  }

  private arm(button: HTMLButtonElement) {
    this.clearArm();
    this.armedButton = button;
    button.textContent = labels.confirmRemove;
    button.setAttribute("aria-label", labels.confirmRemove);
    button.title = labels.confirmRemove;
    Object.assign(button.style, styles.armedAction);
    this.armTimer = window.setTimeout(() => this.clearArm(), layout.confirmMs);
  }

  private clearArm() {
    if (this.armTimer) {
      window.clearTimeout(this.armTimer);
      this.armTimer = 0;
    }
    if (this.armedButton) {
      this.armedButton.textContent = glyphs.remove;
      this.armedButton.setAttribute("aria-label", labels.remove);
      this.armedButton.title = labels.remove;
      Object.assign(this.armedButton.style, styles.action, {
        left: "50%",
        minWidth: "",
        top: "0.375rem",
        transform: "translateX(-50%)",
        whiteSpace: "",
      });
      this.armedButton.style.color = colors.removeText;
      this.armedButton.style.backgroundColor = colors.tealOverlay;
      this.armedButton = null;
    }
  }

  private intelligenceLabel(pageNumber: number) {
    const label = document.createElement("span");
    label.setAttribute("aria-label", labels.intelligenceReady(pageNumber));
    Object.assign(label.style, styles.intelligence);
    return label;
  }

  private chooseFile(event: Event, card: HTMLDivElement, side: "left" | "right") {
    event.stopPropagation();
    if (!this.allowEdit) {
      return;
    }
    const item = this.itemFromCard(card);
    if (!item) {
      return;
    }
    this.pendingAdd = {
      pageId: item.pageId,
      pageIndex: item.pageIndex,
      side,
    };
    this.fileInput.click();
  }

  private handleFilePick() {
    const files = Array.from(this.fileInput.files ?? []);
    const pendingAdd = this.pendingAdd;
    this.fileInput.value = "";
    this.pendingAdd = null;
    if (!this.allowEdit || !files.length || !pendingAdd) {
      return;
    }
    const index = this.items.findIndex((item) => item.pageId === pendingAdd.pageId);
    if (index < 0) {
      return;
    }
    const insertIndex = pendingAdd.side === "left" ? pendingAdd.pageIndex : pendingAdd.pageIndex + 1;
    void Promise.resolve(this.options.onAdd(files, insertIndex))
      .then(() => this.report(messages.add))
      .catch(() => undefined);
  }

  private removePage(event: Event, card: HTMLDivElement) {
    event.stopPropagation();
    if (!this.allowEdit) {
      return;
    }
    const item = this.itemFromCard(card);
    if (!item) {
      return;
    }
    void Promise.resolve(this.options.onRemove(item.pageId)).then(() => {
      this.report(messages.remove);
    }).catch(() => undefined);
  }

  private handleReorder(event: DragEvent, targetCard: HTMLDivElement) {
    if (!this.allowEdit || !this.dragItemId || event.dataTransfer?.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = this.itemFromCard(targetCard);
    if (!target) {
      this.clearDrag();
      return;
    }
    const from = this.items.findIndex((item) => item.pageId === this.dragItemId);
    const to = this.items.findIndex((item) => item.pageId === target.pageId);
    if (from < 0 || to < 0 || from === to) {
      this.clearDrag();
      return;
    }
    const scrollTop = this.root.scrollTop;
    const [item] = this.items.splice(from, 1);
    const fromPageIndex = item.pageIndex;
    const toPageIndex = target.pageIndex;
    this.items.splice(to, 0, item);
    this.items = this.items.map((value, index) => ({
      ...value,
      pageIndex: index,
    }));
    const sourceCard = this.root.querySelector(`[data-item-id="${this.dragItemId}"]`);
    if (sourceCard instanceof HTMLElement) {
      const reference = from < to ? targetCard.nextSibling : targetCard;
      this.root.insertBefore(sourceCard, reference);
    }
    this.refreshCards();
    this.root.scrollTop = scrollTop;
    this.clearDrag();
    void Promise.resolve(this.options.onReorder({
      fromPageIndex,
      toPageIndex,
    })).then(() => this.report(messages.reorder));
  }

  refresh(pageIds: string[], pages: Array<ThumbnailPage | undefined>, activeIndex: number, metadataPages: Set<string>) {
    const scrollTop = this.root.scrollTop;
    this.pageIds = pageIds;
    this.pageCount = pageIds.length;
    this.pages = pages;
    this.metadataPages = metadataPages;
    this.activeIndex = activeIndex;
    this.syncItems();
    this.refreshCards();
    this.root.scrollTop = scrollTop;
  }

  private refreshCards() {
    Array.from(this.root.querySelectorAll("[data-aurora-thumbnail-card]")).forEach((card, index) => {
      if (!(card instanceof HTMLElement)) {
        return;
      }
      const item = this.items[index];
      if (!item) {
        return;
      }
      const pageIndex = item.pageIndex;
      const hasMetadata = this.metadataPages.has(item.pageId);
      card.dataset[data.itemId] = item.pageId;
      card.dataset[data.pageIndex] = String(pageIndex);
      Object.assign(card.style, {
        border: pageIndex === this.activeIndex ? `1px solid ${colors.activeBorder}` : "0",
        borderTop: hasMetadata ? `0.25rem solid ${this.options.intelligenceColor.stroke}` : pageIndex === this.activeIndex ? `1px solid ${colors.activeBorder}` : "0",
      });
      const primary = card.querySelector(`[data-title-primary]`);
      const secondary = card.querySelector(`[data-title-secondary]`);
      if (primary) {
        primary.textContent = labels.page(pageIndex + 1);
      }
      if (secondary) {
        secondary.textContent = this.sizeText(pageIndex);
      }
      const select = card.querySelector("[data-page-select]");
      if (select instanceof HTMLElement) {
        select.setAttribute("aria-label", labels.page(pageIndex + 1));
        if (pageIndex === this.activeIndex) {
          select.setAttribute("aria-current", "page");
        } else {
          select.removeAttribute("aria-current");
        }
      }
      const media = card.querySelector("[data-thumbnail-media]");
      const page = this.pages[pageIndex];
      if (media instanceof HTMLElement) {
        media.setAttribute("aria-label", page ? `${page.sourceName} page ${page.pageNumber}` : labels.thumbLoading(this.sourceName, pageIndex + 1));
      }
      const label = card.querySelector("[aria-label$='has intelligence metadata']");
      if (hasMetadata && !(label instanceof HTMLElement)) {
        card.append(this.intelligenceLabel(pageIndex + 1));
      } else if (hasMetadata && label instanceof HTMLElement) {
        label.setAttribute("aria-label", labels.intelligenceReady(pageIndex + 1));
      } else if (label instanceof HTMLElement) {
        label.remove();
      }
    });
  }

  private itemFromCard(card: HTMLElement) {
    const itemId = card.dataset[data.itemId];
    return this.items.find((value) => value.pageId === itemId) ?? null;
  }

  private syncItems() {
    this.items = this.pageIds.map((pageId, index) => ({
      kind: "page" as const,
      pageId,
      pageIndex: index,
    }));
  }

  private handleDrop(event: DragEvent) {
    const files = event.dataTransfer?.files;
    if (!this.allowEdit || !files?.length) {
      return;
    }
    event.preventDefault();
    void Promise.resolve(this.options.onAdd(Array.from(files), this.pageCount))
      .then(() => this.report(messages.drop))
      .catch(() => undefined);
  }

  private report(message: string) {
    this.live.textContent = message;
  }

  private emitRange() {
    if (!this.pageCount) {
      return;
    }
    this.options.onRange(this.visibleIndexes());
  }

  private visibleIndexes() {
    const visible: number[] = [];
    const top = this.root.scrollTop;
    const bottom = top + this.root.clientHeight;
    Array.from(this.root.children).forEach((child, index) => {
      const item = this.items[index];
      if (!(child instanceof HTMLElement) || !item) {
        return;
      }
      const childTop = child.offsetTop;
      const childBottom = childTop + child.offsetHeight;
      if (childBottom >= top && childTop <= bottom) {
        visible.push(item.pageIndex);
      }
    });
    if (!visible.length) {
      visible.push(Math.max(0, this.activeIndex));
    }
    const first = Math.max(0, Math.min(...visible) - layout.rangeBuffer);
    const last = Math.min(this.pageCount - 1, Math.max(...visible) + layout.rangeBuffer);
    const indexes: number[] = [];
    for (let index = first; index <= last && indexes.length < layout.rangeLimit; index += 1) {
      indexes.push(index);
    }
    return indexes;
  }

  private setDropTarget(itemId: string) {
    if (this.dropTargetId === itemId) {
      return;
    }
    this.root.querySelectorAll("[data-drop-target='true']").forEach((card) => {
      if (card instanceof HTMLElement) {
        delete card.dataset[data.dropTarget];
      }
    });
    this.dropTargetId = itemId;
    if (itemId) {
      const card = this.root.querySelector(`[data-item-id="${itemId}"]`);
      if (card instanceof HTMLElement) {
        card.dataset[data.dropTarget] = "true";
      }
    }
  }

  private clearDrag() {
    this.stopAutoScroll();
    this.root.querySelectorAll("[data-drag-state], [data-drop-target]").forEach((card) => {
      if (card instanceof HTMLElement) {
        delete card.dataset[data.dragState];
        delete card.dataset[data.dropTarget];
      }
    });
    this.dragItemId = "";
    this.dropTargetId = "";
  }

  private updateAutoScroll(event: DragEvent) {
    const rect = this.root.getBoundingClientRect();
    const top = event.clientY - rect.top;
    const bottom = rect.bottom - event.clientY;
    if (top < layout.scrollEdge) {
      this.startAutoScroll(-this.scrollStepFor(top));
    } else if (bottom < layout.scrollEdge) {
      this.startAutoScroll(this.scrollStepFor(bottom));
    } else {
      this.stopAutoScroll();
    }
  }

  private scrollStepFor(distance: number) {
    return Math.ceil(((layout.scrollEdge - Math.max(0, distance)) / layout.scrollEdge) * layout.scrollMax);
  }

  private startAutoScroll(step: number) {
    this.scrollStep = step;
    if (!this.scrollFrame) {
      this.scrollFrame = requestAnimationFrame(() => this.scrollDrag());
    }
  }

  private scrollDrag() {
    this.scrollFrame = 0;
    if (!this.dragItemId || !this.scrollStep) {
      return;
    }
    const scrollTop = this.root.scrollTop;
    this.root.scrollTop += this.scrollStep;
    if (this.root.scrollTop === scrollTop) {
      this.scrollStep = 0;
      return;
    }
    this.emitRange();
    this.scrollFrame = requestAnimationFrame(() => this.scrollDrag());
  }

  private stopAutoScroll() {
    this.scrollStep = 0;
    if (this.scrollFrame) {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = 0;
    }
  }
}
