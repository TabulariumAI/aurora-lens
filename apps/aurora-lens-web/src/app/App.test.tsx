import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { selectionTheme } from "../lens/selectionTheme";
import type { ViewerState, ViewerStatus } from "../lens/types";

const lensMock = vi.hoisted(() => ({
  allowEdit: true,
  decoder: undefined as unknown,
  selectionTheme: undefined as unknown,
  status: "idle" as ViewerStatus,
  state: {
    viewMode: "page",
    status: "idle",
    sourceName: null as string | null,
    pageIndex: -1,
    pageCount: 0,
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
    decodeTiff: vi.fn(),
    firstPage: vi.fn(),
    fitHeight: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    goToPage: vi.fn(),
    lastPage: vi.fn(),
    loadMetadata: vi.fn(),
    nextPage: vi.fn(),
    previousPage: vi.fn(),
    readPageValidationConfig: vi.fn(),
    restoreSession: vi.fn(),
    savePageValidationConfig: vi.fn(),
    search: vi.fn(),
    setDrawMode: vi.fn(),
    showThumbnails: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  },
}));

vi.mock("../aurora/AuroraTiffDecoder", () => ({
  AuroraTiffDecoder: class AuroraTiffDecoder {
    close = vi.fn();
    decode = vi.fn();
    importPages = vi.fn();
    thumbnail = vi.fn();
  },
}));

vi.mock("@tabularium/aurora-lens", () => {
  const DECODER_ERROR_EMPTY_DOCUMENT = "empty_document";
  const DECODER_ERROR_PAGE_OUT_OF_RANGE = "page_out_of_range";
  const DECODER_ERROR_PAGE_SIZE = "page_size";
  const DECODER_ERROR_UNKNOWN = "unknown";
  const DECODER_ERROR_UNREADABLE_DOCUMENT = "unreadable_document";
  class DecoderError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
      this.name = "DecoderError";
    }
  }
  return {
    DECODER_ERROR_EMPTY_DOCUMENT,
    DECODER_ERROR_PAGE_OUT_OF_RANGE,
    DECODER_ERROR_PAGE_SIZE,
    DECODER_ERROR_UNKNOWN,
    DECODER_ERROR_UNREADABLE_DOCUMENT,
    DecoderError,
    isDecoderError: (error: unknown) => error instanceof DecoderError,
  };
});

vi.mock("@tabularium/aurora-lens/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ReactViewer: React.forwardRef(function MockReactViewer(props: {
      allowEdit: boolean;
      decoder?: unknown;
      selectionTheme?: unknown;
      onStateChange?: (state: ViewerState) => void;
      onStatusChange?: (status: string) => void;
      onAddError?: (error: Error) => void;
      onError?: (error: Error) => void;
      onReady?: (lens: typeof lensMock.instance) => void;
    }, ref) {
      lensMock.allowEdit = props.allowEdit;
      lensMock.decoder = props.decoder;
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
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    lensMock.decoder = undefined;
    lensMock.allowEdit = true;
    lensMock.selectionTheme = undefined;
    lensMock.onStateChange = undefined;
    lensMock.onStatusChange = undefined;
    lensMock.onAddError = undefined;
    lensMock.onError = undefined;
    lensMock.status = "idle";
    lensMock.state = {
      ...lensMock.state,
      status: "idle",
      sourceName: null,
      pageIndex: -1,
      pageCount: 0,
      pageWidth: null,
      pageHeight: null,
      zoom: 1,
      coordinates: null,
      displayCoordinates: null,
      selectionCounts: { tokens: 0, figures: 0, context: 0 },
    };
    lensMock.instance.loadMetadata.mockResolvedValue(undefined);
    lensMock.instance.decodeTiff.mockResolvedValue(undefined);
    lensMock.instance.readPageValidationConfig.mockResolvedValue({
      formats: [
        { name: "letter", width: 8.5, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
    });
    lensMock.instance.restoreSession.mockResolvedValue(false);
    lensMock.instance.savePageValidationConfig.mockImplementation((config) => Promise.resolve(config));
  });

  it("loads one valid TIFF through Tabularium AI Lens", async () => {
    render(<App />);

    expect(screen.getByText("Choose, drop, or select a sample TIFF file.")).toBeInTheDocument();

    const file = new File(["tiff"], "sample.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [file],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1));
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(1);
    expect(lensMock.instance.loadMetadata).not.toHaveBeenCalled();
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledWith(file, 0);
    expect(lensMock.instance.clear.mock.invocationCallOrder[0]).toBeLessThan(lensMock.instance.decodeTiff.mock.invocationCallOrder[0]);
  });

  it("requests package-owned session restore when Tabularium AI Lens is ready", async () => {
    render(<App />);

    await waitFor(() => expect(lensMock.instance.restoreSession).toHaveBeenCalledTimes(1));
  });

  it("loads page validation config when Tabularium AI Lens is ready", async () => {
    lensMock.instance.readPageValidationConfig.mockResolvedValue({
      formats: [
        { name: "letter", width: 8.25, height: 10.75 },
      ],
      tolerance: 0.01,
    });

    render(<App />);

    await waitFor(() => expect(screen.getByLabelText("Tolerance")).toHaveValue(0.01));
    expect(screen.getByLabelText("letter width")).toHaveValue(8.25);
    expect(screen.getByLabelText("letter height")).toHaveValue(10.75);
  });

  it("saves drafted page validation config through Tabularium AI Lens", async () => {
    render(<App />);

    await waitFor(() => expect(lensMock.instance.readPageValidationConfig).toHaveBeenCalledTimes(1));
    fireEvent.change(await screen.findByLabelText("letter width"), {
      target: {
        value: "8.25",
      },
    });
    expect(lensMock.instance.savePageValidationConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(lensMock.instance.savePageValidationConfig).toHaveBeenCalledWith({
      formats: [
        { name: "letter", width: 8.25, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
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
    const { DecoderError } = await import("@tabularium/aurora-lens");
    lensMock.instance.decodeTiff.mockRejectedValue(new DecoderError("empty_document", "Empty document."));
    render(<App />);

    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [new File(["tiff"], "empty.tiff", { type: "image/tiff" })],
      },
    });

    const dialog = await screen.findByRole("alertdialog", { name: "Document Error" });
    expect(within(dialog).getByText("This document does not contain readable pages.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    expect(screen.queryByRole("alertdialog", { name: "Document Error" })).not.toBeInTheDocument();
  });

  it("shows add-page decoder errors as a dialog", async () => {
    const { DecoderError } = await import("@tabularium/aurora-lens");
    render(<App />);

    act(() => {
      lensMock.onAddError?.(new DecoderError("page_size", "Page size rejected."));
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
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1);
    const file = lensMock.instance.decodeTiff.mock.calls[0][0] as File;
    expect(file.name).toBe("sample.tiff");
    expect(file.type).toBe("image/tiff");
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledWith(file, 0);
  });

  it("starts sample decode after metadata and TIFF load successfully", async () => {
    const metadata = { pages: [] };
    const tiff = new Blob(["tiff"], { type: "image/tiff" });
    let finishDecode: () => void = () => undefined;
    lensMock.instance.decodeTiff.mockReturnValue(new Promise<void>((resolve) => {
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
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1);
    finishDecode();
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1);
  });

  it("starts selected TIFF decode through Tabularium AI Lens", async () => {
    let finishDecode: () => void = () => undefined;
    lensMock.instance.decodeTiff.mockReturnValue(new Promise<void>((resolve) => {
      finishDecode = resolve;
    }));
    render(<App />);

    const file = new File(["tiff"], "delayed.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [file],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledWith(file, 0));
    finishDecode();
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1);
  });

  it("clears existing lens data before loading a new user-selected TIFF", async () => {
    render(<App />);

    const first = new File(["first"], "first.tiff", { type: "image/tiff" });
    const second = new File(["second"], "second.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [first],
      },
    });
    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [second],
      },
    });

    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(2));
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(2);
    expect(lensMock.instance.loadMetadata).not.toHaveBeenCalled();
    expect(lensMock.instance.decodeTiff.mock.calls[1]).toEqual([second, 0]);
    expect(lensMock.instance.clear.mock.invocationCallOrder[1]).toBeLessThan(lensMock.instance.decodeTiff.mock.invocationCallOrder[1]);
  });

  it("passes the host decoder and selection theme into Tabularium AI Lens", () => {
    render(<App />);

    expect(lensMock.decoder).toBeDefined();
    expect(lensMock.selectionTheme).toEqual(selectionTheme);
  });

  it("rejects multiple dropped files before calling Tabularium AI Lens", async () => {
    render(<App />);

    fireEvent.drop(screen.getByRole("button", { name: "Drop one TIFF here" }), {
      dataTransfer: {
        files: [
          new File(["one"], "one.tiff", { type: "image/tiff" }),
          new File(["two"], "two.tiff", { type: "image/tiff" }),
        ],
      },
    });

    const dialog = screen.getByRole("alertdialog", { name: "Document Error" });
    expect(within(dialog).getByText("Choose or drop one TIFF file at a time.")).toBeInTheDocument();
    expect(lensMock.instance.decodeTiff).not.toHaveBeenCalled();
    expect(lensMock.instance.clear).not.toHaveBeenCalled();
  });

  it("rejects non-TIFF files without clearing the current viewer", async () => {
    render(<App />);

    const tiff = new File(["tiff"], "sample.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [tiff],
      },
    });
    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [new File(["pdf"], "document_1.pdf", { type: "application/pdf" })],
      },
    });

    const dialog = screen.getByRole("alertdialog", { name: "Document Error" });
    expect(within(dialog).getByText("Choose a .tif or .tiff file.")).toBeInTheDocument();
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1);
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(1);
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

    render(<App />);

    const details = within(screen.getByLabelText("Page details"));
    expect(details.getByText("sample.tiff")).toBeInTheDocument();
    expect(details.getByText("1 of 2")).toBeInTheDocument();
    expect(details.getByText("100 x 200")).toBeInTheDocument();
    expect(details.getByText("125%")).toBeInTheDocument();
    expect(details.queryByText("X 3, Y 4")).not.toBeInTheDocument();
    expect(details.queryByText("X 30, Y 40")).not.toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Document" })).toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Selection" })).toBeInTheDocument();
    expect(details.getByRole("heading", { name: "Style" })).toBeInTheDocument();
    expect(details.getByLabelText("Context fill rgba(255, 230, 128, 0.25)")).toBeInTheDocument();
    expect(details.getByText("High >=95%")).toBeInTheDocument();
    expect(details.getByText("Medium >=80%")).toBeInTheDocument();
    expect(details.getByText("Low <80%")).toBeInTheDocument();
  });
});
