import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { selectionTheme } from "../lens/selectionTheme";
import type { ViewerState, ViewerStatus } from "../lens/types";

const lensMock = vi.hoisted(() => ({
  allowEdit: true,
  selectionTheme: undefined as unknown,
  status: "idle" as ViewerStatus,
  state: {
    viewMode: "page",
    status: "idle",
    sourceName: null as string | null,
    pageIndex: -1,
    pageCount: 0,
    metadataPageCount: 0,
    pageInfo: null,
    pageWidth: null as number | null,
    pageHeight: null as number | null,
    zoom: 1,
    coordinates: null as { x: number; y: number } | null,
    displayCoordinates: null as { x: number; y: number } | null,
    selectionCounts: { tokens: 0, figures: 0, context: 0 },
    drawMode: false,
    canZoomIn: false,
    canZoomOut: false,
    canFitWidth: false,
    canFitHeight: false,
    canFitPage: false,
    canActualSize: false,
    canGoFirst: false,
    canGoPrevious: false,
    canGoNext: false,
    canGoLast: false,
    canShowThumbnails: false,
    canSearch: false,
    canDraw: false,
    canClearSelection: false,
    canCopy: false,
  } as ViewerState,
  onStateChange: undefined as ((state: ViewerState) => void) | undefined,
  onStatusChange: undefined as ((status: string) => void) | undefined,
  onAddError: undefined as ((error: Error) => void) | undefined,
  onError: undefined as ((error: Error) => void) | undefined,
  instance: {
    actualSize: vi.fn(),
    addPages: vi.fn(),
    clear: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: vi.fn(),
    decodeDoc: vi.fn(),
    exportTiff: vi.fn(),
    firstPage: vi.fn(),
    fitHeight: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    goToPage: vi.fn(),
    lastPage: vi.fn(),
    loadMetadata: vi.fn(),
    nextPage: vi.fn(),
    previousPage: vi.fn(),
    readViewerConfig: vi.fn(),
    restoreSession: vi.fn(),
    saveViewerConfig: vi.fn(),
    search: vi.fn(),
    searchIndex: vi.fn(),
    setDrawMode: vi.fn(),
    showThumbnails: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  },
}));

vi.mock("@tabularium/aurora-lens", () => {
  const LENS_ERROR_EMPTY_DOCUMENT = "empty_document";
  const LENS_ERROR_PAGE_OUT_OF_RANGE = "page_out_of_range";
  const LENS_ERROR_PAGE_SIZE = "page_size";
  const LENS_ERROR_RASTER_LIMIT = "raster_limit";
  const LENS_ERROR_UNSUPPORTED_FORMAT = "unsupported_format";
  const LENS_ERROR_UNKNOWN = "unknown";
  const LENS_ERROR_UNREADABLE_DOCUMENT = "unreadable_document";
  const TIFF_PIXEL_FORMAT_BW1 = "bw1";
  const TIFF_PIXEL_FORMAT_GRAY8 = "gray8";
  const TIFF_PIXEL_FORMAT_RGB24 = "rgb24";
  const defaultViewerConfig = () => ({
    formats: [
      { name: "letter", width: 8.5, height: 11 },
      { name: "legal", width: 8.5, height: 14 },
      { name: "a4", width: 8.27, height: 11.69 },
    ],
    tolerance: 0.02,
    view: {
      pdfRasterDpi: 150,
      maxRasterPixels: 40_000_000,
      maxRasterWidth: 10_000,
      maxRasterHeight: 10_000,
    },
    export: {
      pdfRasterDpi: 300,
      maxRasterPixels: 160_000_000,
      maxRasterWidth: 20_000,
      maxRasterHeight: 20_000,
      tiff: {
        compression: 5,
        pixelFormat: TIFF_PIXEL_FORMAT_RGB24,
      },
    },
  });
  class LensError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
      this.name = "LensError";
    }
  }
  return {
    LENS_ERROR_EMPTY_DOCUMENT,
    LENS_ERROR_PAGE_OUT_OF_RANGE,
    LENS_ERROR_PAGE_SIZE,
    LENS_ERROR_RASTER_LIMIT,
    LENS_ERROR_UNSUPPORTED_FORMAT,
    LENS_ERROR_UNKNOWN,
    LENS_ERROR_UNREADABLE_DOCUMENT,
    LensError,
    TIFF_PIXEL_FORMAT_BW1,
    TIFF_PIXEL_FORMAT_GRAY8,
    TIFF_PIXEL_FORMAT_RGB24,
    defaultViewerConfig,
    isLensError: (error: unknown) => error instanceof LensError,
  };
});

vi.mock("@tabularium/aurora-lens/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ReactViewer: React.forwardRef(function MockReactViewer(props: {
      allowEdit: boolean;
      selectionTheme?: unknown;
      onStateChange?: (state: ViewerState) => void;
      onStatusChange?: (status: string) => void;
      onAddError?: (error: Error) => void;
      onError?: (error: Error) => void;
      onReady?: (lens: typeof lensMock.instance) => void;
    }, ref) {
      lensMock.allowEdit = props.allowEdit;
      lensMock.selectionTheme = props.selectionTheme;
      React.useImperativeHandle(ref, () => lensMock.instance);
      React.useEffect(() => {
        lensMock.onStateChange = props.onStateChange;
        lensMock.onStatusChange = props.onStatusChange;
        lensMock.onAddError = props.onAddError;
        lensMock.onError = props.onError;
        props.onStateChange?.(lensMock.state);
        props.onStatusChange?.(lensMock.status);
        props.onReady?.(lensMock.instance);
        return () => {
          lensMock.onStateChange = undefined;
          lensMock.onStatusChange = undefined;
          lensMock.onAddError = undefined;
          lensMock.onError = undefined;
        };
      }, []);
      return React.createElement("button", {
        "data-testid": "aurora-lens",
        type: "button",
      });
    }),
  };
});

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    lensMock.allowEdit = true;
    lensMock.selectionTheme = undefined;
    lensMock.onStateChange = undefined;
    lensMock.onStatusChange = undefined;
    lensMock.onAddError = undefined;
    lensMock.onError = undefined;
    lensMock.status = "idle";
    lensMock.state = {
      ...lensMock.state,
      viewMode: "page",
      status: "idle",
      sourceName: null,
      pageIndex: -1,
      pageCount: 0,
      pageInfo: null,
      pageWidth: null,
      pageHeight: null,
      zoom: 1,
      coordinates: null,
      displayCoordinates: null,
      selectionCounts: { tokens: 0, figures: 0, context: 0 },
    };
    lensMock.instance.loadMetadata.mockResolvedValue(undefined);
    lensMock.instance.decodeDoc.mockResolvedValue(undefined);
    lensMock.instance.readViewerConfig.mockResolvedValue({
      formats: [
        { name: "letter", width: 8.5, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
      view: {
        pdfRasterDpi: 150,
        maxRasterPixels: 40_000_000,
        maxRasterWidth: 10_000,
        maxRasterHeight: 10_000,
      },
      export: {
        pdfRasterDpi: 300,
        maxRasterPixels: 160_000_000,
        maxRasterWidth: 20_000,
        maxRasterHeight: 20_000,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    });
    lensMock.instance.exportTiff.mockResolvedValue(new Blob(["tiff"], { type: "image/tiff" }));
    lensMock.instance.restoreSession.mockResolvedValue(false);
    lensMock.instance.saveViewerConfig.mockImplementation((config) => Promise.resolve(config));
  });

  it("loads one valid TIFF through Tabularium AI Lens", async () => {
    render(<App />);

    expect(screen.getByText("Choose, drop, or select a sample document.")).toBeInTheDocument();

    const file = new File(["tiff"], "sample.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [file],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1));
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(1);
    expect(lensMock.instance.loadMetadata).not.toHaveBeenCalled();
    expect(lensMock.instance.decodeDoc).toHaveBeenCalledWith(file, 0);
    expect(lensMock.instance.clear.mock.invocationCallOrder[0]).toBeLessThan(lensMock.instance.decodeDoc.mock.invocationCallOrder[0]);
  });

  it("requests package-owned session restore when Tabularium AI Lens is ready", async () => {
    render(<App />);

    await waitFor(() => expect(lensMock.instance.restoreSession).toHaveBeenCalledTimes(1));
  });

  it("loads viewer config when Tabularium AI Lens is ready", async () => {
    lensMock.instance.readViewerConfig.mockResolvedValue({
      formats: [
        { name: "letter", width: 8.25, height: 10.75 },
      ],
      tolerance: 0.01,
      view: {
        pdfRasterDpi: 125,
        maxRasterPixels: 30_000_000,
        maxRasterWidth: 9_000,
        maxRasterHeight: 9_000,
      },
      export: {
        pdfRasterDpi: 300,
        maxRasterPixels: 160_000_000,
        maxRasterWidth: 20_000,
        maxRasterHeight: 20_000,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    });

    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Image Settings" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Image Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Image Settings" });
    expect(within(dialog).getByLabelText("Tolerance")).toHaveValue(0.01);
    expect(within(dialog).getByLabelText("letter width")).toHaveValue(8.25);
    expect(within(dialog).getByLabelText("letter height")).toHaveValue(10.75);
    expect(within(dialog).getByLabelText("View PDF DPI")).toHaveValue(125);
  });

  it("saves drafted viewer config through Tabularium AI Lens", async () => {
    render(<App />);

    await waitFor(() => expect(lensMock.instance.readViewerConfig).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Image Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Image Settings" });
    fireEvent.change(within(dialog).getByLabelText("letter width"), {
      target: {
        value: "8.25",
      },
    });
    expect(lensMock.instance.saveViewerConfig).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(lensMock.instance.saveViewerConfig).toHaveBeenCalledWith({
      formats: [
        { name: "letter", width: 8.25, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
      view: {
        pdfRasterDpi: 150,
        maxRasterPixels: 40_000_000,
        maxRasterWidth: 10_000,
        maxRasterHeight: 10_000,
      },
      export: {
        pdfRasterDpi: 300,
        maxRasterPixels: 160_000_000,
        maxRasterWidth: 20_000,
        maxRasterHeight: 20_000,
        tiff: {
          compression: 5,
          pixelFormat: "rgb24",
        },
      },
    }));
  });

  it("passes right sidebar edit toggle state to Tabularium AI Lens", () => {
    render(<App />);

    const toggle = screen.getByLabelText("Edit pages");
    expect(toggle).toBeChecked();
    expect(lensMock.allowEdit).toBe(true);

    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(lensMock.allowEdit).toBe(false);
  });

  it("downloads TIFF export from the right sidebar", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    render(<App />);

    act(() => {
      lensMock.onStateChange?.({
        ...lensMock.state,
        sourceName: "sample.pdf",
        pageIndex: 0,
        pageCount: 1,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Download TIFF" }));

    await waitFor(() => expect(lensMock.instance.exportTiff).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "image/tiff" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });

  it("blocks the viewer after a fatal lens error until OK resets it", async () => {
    render(<App />);

    act(() => {
      lensMock.onError?.(new Error("Remaining page storage failed."));
      lensMock.onStatusChange?.("error");
    });

    const dialog = screen.getByRole("alertdialog", { name: "Viewer Error" });
    expect(within(dialog).getByText("Remaining page storage failed.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    expect(lensMock.instance.clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog", { name: "Viewer Error" })).not.toBeInTheDocument();
  });

  it("shows main document decoder errors as a dialog", async () => {
    const { LensError } = await import("@tabularium/aurora-lens");
    lensMock.instance.decodeDoc.mockRejectedValue(new LensError("empty_document", "Empty document."));
    render(<App />);

    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [new File(["tiff"], "empty.tiff", { type: "image/tiff" })],
      },
    });

    const dialog = await screen.findByRole("alertdialog", { name: "Document Error" });
    expect(within(dialog).getByText("This document does not contain readable pages.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    expect(screen.queryByRole("alertdialog", { name: "Document Error" })).not.toBeInTheDocument();
  });

  it("shows main document page-size errors with the decoder message", async () => {
    const { LensError } = await import("@tabularium/aurora-lens");
    lensMock.instance.decodeDoc.mockRejectedValue(new LensError("page_size", "image.png: page 1 rejected. Page size 512x512 does not match configured formats"));
    render(<App />);

    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [new File(["png"], "image.png", { type: "image/png" })],
      },
    });

    const dialog = await screen.findByRole("alertdialog", { name: "Document Error" });
    expect(within(dialog).getByText("image.png: page 1 rejected. Page size 512x512 does not match configured formats")).toBeInTheDocument();
  });

  it("shows add-page decoder errors as a dialog", async () => {
    const { LensError } = await import("@tabularium/aurora-lens");
    render(<App />);

    act(() => {
      lensMock.onAddError?.(new LensError("page_size", "Page size rejected."));
    });

    const dialog = screen.getByRole("alertdialog", { name: "Add Pages Error" });
    expect(within(dialog).getByText("Some pages did not match the configured page size. The pages that loaded successfully were kept.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    expect(screen.queryByRole("alertdialog", { name: "Add Pages Error" })).not.toBeInTheDocument();
  });

  it("loads selected samples through Tabularium AI Lens", async () => {
    const metadata = { pages: [] };
    const tiff = new Blob(["tiff"], { type: "image/tiff" });
    const fetchMock = vi.fn((url: string) => {
      if (url === "/samples/sample-1/sample.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(metadata),
        });
      }
      if (url === "/samples/sample-1/sample.tiff") {
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(tiff),
        });
      }
      return Promise.resolve({
        ok: false,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "sample-1" }));

    await waitFor(() => expect(lensMock.instance.loadMetadata).toHaveBeenCalledWith(metadata));
    expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1);
    const file = lensMock.instance.decodeDoc.mock.calls[0][0] as File;
    expect(file.name).toBe("sample.tiff");
    expect(file.type).toBe("image/tiff");
    expect(lensMock.instance.decodeDoc).toHaveBeenCalledWith(file, 0);
  });

  it("starts sample decode after metadata and TIFF load successfully", async () => {
    const metadata = { pages: [] };
    const tiff = new Blob(["tiff"], { type: "image/tiff" });
    let finishDecode: () => void = () => undefined;
    lensMock.instance.decodeDoc.mockReturnValue(new Promise<void>((resolve) => {
      finishDecode = resolve;
    }));
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/samples/sample-1/sample.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(metadata),
        });
      }
      if (url === "/samples/sample-1/sample.tiff") {
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(tiff),
        });
      }
      return Promise.resolve({ ok: false });
    }));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "sample-1" }));

    await waitFor(() => expect(lensMock.instance.loadMetadata).toHaveBeenCalledWith(metadata));
    expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1);
    finishDecode();
    expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1);
  });

  it("starts selected TIFF decode through Tabularium AI Lens", async () => {
    let finishDecode: () => void = () => undefined;
    lensMock.instance.decodeDoc.mockReturnValue(new Promise<void>((resolve) => {
      finishDecode = resolve;
    }));
    render(<App />);

    const file = new File(["tiff"], "delayed.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [file],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeDoc).toHaveBeenCalledWith(file, 0));
    finishDecode();
    expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1);
  });

  it("clears existing lens data before loading a new user-selected TIFF", async () => {
    render(<App />);

    const first = new File(["first"], "first.tiff", { type: "image/tiff" });
    const second = new File(["second"], "second.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [first],
      },
    });
    await waitFor(() => expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [second],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(2));
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(2);
    expect(lensMock.instance.loadMetadata).not.toHaveBeenCalled();
    expect(lensMock.instance.decodeDoc.mock.calls[1]).toEqual([second, 0]);
    expect(lensMock.instance.clear.mock.invocationCallOrder[1]).toBeLessThan(lensMock.instance.decodeDoc.mock.invocationCallOrder[1]);
  });

  it("passes the selection theme into Tabularium AI Lens", () => {
    render(<App />);

    expect(lensMock.selectionTheme).toEqual(selectionTheme);
  });

  it("rejects multiple dropped files before calling Tabularium AI Lens", async () => {
    render(<App />);

    fireEvent.drop(screen.getByRole("button", { name: "Drop one document here" }), {
      dataTransfer: {
        files: [
          new File(["one"], "one.tiff", { type: "image/tiff" }),
          new File(["two"], "two.tiff", { type: "image/tiff" }),
        ],
      },
    });

    const dialog = screen.getByRole("alertdialog", { name: "Document Error" });
    expect(within(dialog).getByText("Choose or drop one document at a time.")).toBeInTheDocument();
    expect(lensMock.instance.decodeDoc).not.toHaveBeenCalled();
    expect(lensMock.instance.clear).not.toHaveBeenCalled();
  });

  it("passes PDF files to Tabularium AI Lens", async () => {
    render(<App />);

    const tiff = new File(["tiff"], "sample.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [tiff],
      },
    });
    await waitFor(() => expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(1));

    const pdf = new File(["pdf"], "document_1.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Load document"), {
      target: {
        files: [pdf],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeDoc).toHaveBeenCalledTimes(2));
    expect(lensMock.instance.decodeDoc.mock.calls[1]).toEqual([pdf, 0]);
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(2);
  });

  it("maps lens state into the details panel", () => {
    lensMock.status = "ready";
    lensMock.state = {
      ...lensMock.state,
      status: "ready",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 2,
      pageWidth: 100,
      pageHeight: 200,
      zoom: 1.25,
      coordinates: { x: 3, y: 4 },
      displayCoordinates: { x: 30, y: 40 },
      selectionCounts: { tokens: 1, figures: 2, context: 3 },
    };
    lensMock.state.pageInfo = {
      pageNumber: 1,
      class: "assumed name abandonment",
      segments: ["Exhibit", "Recital"],
      indexes: [
        {
          label: "Recording Number",
          value: "20250631357",
          source: "Document Number: 20250631357",
          ambiguous: "NO",
        },
      ],
    };

    render(<App />);

    const details = within(screen.getByLabelText("Page details"));
    expect(details.getByText("sample.tiff")).toBeInTheDocument();
    expect(details.getByText("1 of 2")).toBeInTheDocument();
    expect(details.getByText("100 x 200")).toBeInTheDocument();
    expect(details.getByText("125%")).toBeInTheDocument();
    expect(details.queryByText("X 3, Y 4")).not.toBeInTheDocument();
    expect(details.queryByText("X 30, Y 40")).not.toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Document" })).toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Page Info" })).toBeInTheDocument();
    expect(details.getByText("assumed name abandonment")).toBeInTheDocument();
    expect(details.getByText("Exhibit, Recital")).toBeInTheDocument();
    expect(details.queryByText("Recording Number: 20250631357")).not.toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Selection" })).toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Style" })).toBeInTheDocument();
    expect(details.getByLabelText("Context fill rgba(255, 230, 128, 0.25)")).toBeInTheDocument();
    expect(details.getByText("High >=95%")).toBeInTheDocument();
    expect(details.getByText("Medium >=80%")).toBeInTheDocument();
    expect(details.getByText("Low <80%")).toBeInTheDocument();
  });

  it("runs an index search from the intelligence toolbar", () => {
    lensMock.status = "ready";
    lensMock.state = {
      ...lensMock.state,
      status: "ready",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 1,
      metadataPageCount: 1,
      pageWidth: 100,
      pageHeight: 200,
      canSearch: true,
      canDraw: true,
    };
    lensMock.state.pageInfo = {
      pageNumber: 1,
      class: null,
      segments: [],
      indexes: [
        {
          label: "Recording Number",
          value: "20250631357",
          source: "Document Number: 20250631357",
          ambiguous: "NO",
        },
        {
          label: "Recorded Date",
          value: "January 08, 2025",
          source: "Recorded Date: January 08, 2025",
          ambiguous: "NO",
        },
      ],
    };
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Search indexes" }));
    expect(screen.getByLabelText("Document index")).toHaveDisplayValue("Recording Number: 20250631357");
    expect(container.querySelector(".viewer-toolbar .viewer-zoom-label")).toBeNull();
    fireEvent.change(screen.getByLabelText("Document index"), {
      target: {
        value: "1",
      },
    });
    act(() => {
      lensMock.onStateChange?.({
        ...lensMock.state,
        zoom: 1.5,
        pageInfo: {
          pageNumber: 1,
          class: null,
          segments: [],
          indexes: [
            {
              label: "Recording Number",
              value: "20250631357",
              source: "Document Number: 20250631357",
              ambiguous: "NO",
            },
            {
              label: "Recorded Date",
              value: "January 08, 2025",
              source: "Recorded Date: January 08, 2025",
              ambiguous: "NO",
            },
          ],
        },
      });
    });
    expect(screen.getByLabelText("Document index")).toHaveDisplayValue("Recorded Date: January 08, 2025");
    fireEvent.click(screen.getByRole("button", { name: "Go to selected index" }));

    expect(lensMock.instance.searchIndex).toHaveBeenCalledWith(1, {
      label: "Recorded Date",
      value: "January 08, 2025",
      source: "Recorded Date: January 08, 2025",
      ambiguous: "NO",
    });
  });

  it("keeps search and index search mutually exclusive", () => {
    lensMock.status = "ready";
    lensMock.state = {
      ...lensMock.state,
      status: "ready",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 1,
      metadataPageCount: 1,
      pageWidth: 100,
      pageHeight: 200,
      canSearch: true,
    };
    lensMock.state.pageInfo = {
      pageNumber: 1,
      class: null,
      segments: [],
      indexes: [
        {
          label: "Recording Number",
          value: "20250631357",
          source: "Document Number: 20250631357",
          ambiguous: "NO",
        },
      ],
    };
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search indexes" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Document index")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.queryByLabelText("Document index")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows loading progress as a blocking detached overlay", () => {
    lensMock.status = "loadingPage";
    lensMock.state = {
      ...lensMock.state,
      status: "loadingPage",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 2,
      metadataPageCount: 2,
      viewMode: "thumbnails",
    };
    render(<App />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Please wait...");
    expect(status.parentElement).toHaveClass("viewer-progress-overlay");
    expect(status.parentElement).not.toHaveClass("viewer-message");
  });

  it("labels add-page progress as adding pages", () => {
    lensMock.status = "addingPages";
    lensMock.state = {
      ...lensMock.state,
      status: "addingPages",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 2,
      metadataPageCount: 2,
      viewMode: "thumbnails",
    };
    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Adding pages...");
  });

  it("marks the search field when a submitted search returns no results", () => {
    lensMock.status = "ready";
    lensMock.instance.search.mockReturnValue({
      tokens: [],
      contexts: [],
      figures: [],
    });
    lensMock.state = {
      ...lensMock.state,
      status: "ready",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 1,
      metadataPageCount: 1,
      pageWidth: 100,
      pageHeight: 200,
      canSearch: true,
    };
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, {
      target: {
        value: "missing",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search text" }));

    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(input, {
      target: {
        value: "updated",
      },
    });

    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("reports partial intelligence when only some pages have metadata", () => {
    lensMock.status = "ready";
    lensMock.state = {
      ...lensMock.state,
      status: "ready",
      sourceName: "sample.tiff",
      pageIndex: 0,
      pageCount: 2,
      metadataPageCount: 1,
      canSearch: true,
    };
    render(<App />);

    expect(screen.queryByLabelText("Intelligence ready")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Intelligence metadata exists for 1 of 2 document pages")).toHaveTextContent("Partial intelligence 1/2");
  });
});
