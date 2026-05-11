import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { selectionTheme } from "../lens/selectionTheme";
import type { ViewerState, ViewerStatus } from "../lens/types";
import type { ViewerSession } from "./viewerSessionDb";

const lensMock = vi.hoisted(() => ({
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
  instance: {
    actualSize: vi.fn(),
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
    search: vi.fn(),
    setDrawMode: vi.fn(),
    showThumbnails: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  },
}));

const sessionDbMock = vi.hoisted(() => {
  let activeSession: ViewerSession | null = null;
  return {
    saveActiveViewerSession: vi.fn(async (session: ViewerSession) => {
      activeSession = session;
    }),
    readActiveViewerSession: vi.fn(async () => activeSession),
    deleteActiveViewerSession: vi.fn(async () => {
      activeSession = null;
    }),
    activeSession: () => activeSession,
    setActiveSession: (session: ViewerSession | null) => {
      activeSession = session;
    },
  };
});

vi.mock("../aurora/AuroraTiffDecoder", () => ({
  AuroraTiffDecoder: class AuroraTiffDecoder {
    close = vi.fn();
    decode = vi.fn();
    thumbnail = vi.fn();
  },
}));

vi.mock("./viewerSessionDb", () => ({
  ACTIVE_VIEWER_SESSION_ID: "active",
  saveActiveViewerSession: sessionDbMock.saveActiveViewerSession,
  readActiveViewerSession: sessionDbMock.readActiveViewerSession,
  deleteActiveViewerSession: sessionDbMock.deleteActiveViewerSession,
}));

vi.mock("@tabularium/aurora-lens/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    ReactViewer: React.forwardRef(function MockReactViewer(props: {
      decoder?: unknown;
      selectionTheme?: unknown;
      onStateChange?: (state: ViewerState) => void;
      onStatusChange?: (status: string) => void;
      onThumbnailSelect?: (pageIndex: number) => void;
    }, ref) {
      lensMock.decoder = props.decoder;
      lensMock.selectionTheme = props.selectionTheme;
      React.useImperativeHandle(ref, () => lensMock.instance);
      React.useEffect(() => {
        lensMock.onStateChange = props.onStateChange;
        lensMock.onStatusChange = props.onStatusChange;
        props.onStateChange?.(lensMock.state);
        props.onStatusChange?.(lensMock.status);
        return () => {
          lensMock.onStateChange = undefined;
          lensMock.onStatusChange = undefined;
        };
      }, [props]);
      return React.createElement("button", {
        "data-testid": "aurora-lens",
        onClick: () => props.onThumbnailSelect?.(1),
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
    sessionDbMock.setActiveSession(null);
    lensMock.decoder = undefined;
    lensMock.selectionTheme = undefined;
    lensMock.onStateChange = undefined;
    lensMock.onStatusChange = undefined;
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
    await waitFor(() => expect(sessionDbMock.saveActiveViewerSession).toHaveBeenCalledTimes(1));
    expect(sessionDbMock.activeSession()).toMatchObject({
      fileName: "sample.tiff",
      fileType: "image/tiff",
      metadata: null,
      pageIndex: 0,
    });
  });

  it("opens selected thumbnails through the host-owned page API", () => {
    render(<App />);

    fireEvent.click(screen.getByTestId("aurora-lens"));

    expect(lensMock.instance.goToPage).toHaveBeenCalledWith(1);
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
    await waitFor(() => expect(sessionDbMock.saveActiveViewerSession).toHaveBeenCalledTimes(1));
    expect(sessionDbMock.activeSession()).toMatchObject({
      fileName: "sample.tiff",
      fileType: "image/tiff",
      metadata,
      pageIndex: 0,
    });
  });

  it("restores a metadata-backed viewer session from IndexedDB", async () => {
    const metadata = { pages: [] };
    const fileBlob = new Blob(["tiff"], { type: "image/tiff" });
    sessionDbMock.setActiveSession({
      id: "active",
      fileName: "restored.tiff",
      fileType: "image/tiff",
      fileBlob,
      metadata,
      pageIndex: 1,
      updatedAt: Date.now(),
    });

    render(<App />);

    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1));
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(1);
    expect(lensMock.instance.loadMetadata).toHaveBeenCalledWith(metadata);
    const file = lensMock.instance.decodeTiff.mock.calls[0][0] as File;
    expect(file.name).toBe("restored.tiff");
    expect(file.type).toBe("image/tiff");
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledWith(file, 1);
    expect(lensMock.instance.clear.mock.invocationCallOrder[0]).toBeLessThan(lensMock.instance.loadMetadata.mock.invocationCallOrder[0]);
    expect(lensMock.instance.loadMetadata.mock.invocationCallOrder[0]).toBeLessThan(lensMock.instance.decodeTiff.mock.invocationCallOrder[0]);
  });

  it("restores a no-intelligence viewer session without loading metadata", async () => {
    const fileBlob = new Blob(["tiff"], { type: "image/tiff" });
    sessionDbMock.setActiveSession({
      id: "active",
      fileName: "plain.tiff",
      fileType: "",
      fileBlob,
      metadata: null,
      pageIndex: 0,
      updatedAt: Date.now(),
    });

    render(<App />);

    await waitFor(() => expect(lensMock.instance.decodeTiff).toHaveBeenCalledTimes(1));
    expect(lensMock.instance.clear).toHaveBeenCalledTimes(1);
    expect(lensMock.instance.loadMetadata).not.toHaveBeenCalled();
    const file = lensMock.instance.decodeTiff.mock.calls[0][0] as File;
    expect(file.name).toBe("plain.tiff");
    expect(file.type).toBe("image/tiff");
    expect(lensMock.instance.decodeTiff).toHaveBeenCalledWith(file, 0);
    expect(lensMock.instance.clear.mock.invocationCallOrder[0]).toBeLessThan(lensMock.instance.decodeTiff.mock.invocationCallOrder[0]);
  });

  it("saves a sample shortcut only after metadata and TIFF load successfully", async () => {
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
    expect(sessionDbMock.saveActiveViewerSession).not.toHaveBeenCalled();
    finishDecode();

    await waitFor(() => expect(sessionDbMock.saveActiveViewerSession).toHaveBeenCalledTimes(1));
    expect(sessionDbMock.activeSession()).toMatchObject({
      fileName: "sample.tiff",
      fileType: "image/tiff",
      metadata,
      pageIndex: 0,
    });
  });

  it("saves a selected TIFF only after decode succeeds", async () => {
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
    expect(sessionDbMock.saveActiveViewerSession).not.toHaveBeenCalled();
    finishDecode();

    await waitFor(() => expect(sessionDbMock.saveActiveViewerSession).toHaveBeenCalledTimes(1));
    expect(sessionDbMock.activeSession()).toMatchObject({
      fileName: "delayed.tiff",
      fileType: "image/tiff",
      metadata: null,
      pageIndex: 0,
    });
  });

  it("updates the persisted page index when the lens page changes", async () => {
    render(<App />);

    const file = new File(["tiff"], "paged.tiff", { type: "image/tiff" });
    fireEvent.change(screen.getByLabelText("Load TIFF"), {
      target: {
        files: [file],
      },
    });
    await waitFor(() => expect(sessionDbMock.saveActiveViewerSession).toHaveBeenCalledTimes(1));

    act(() => {
      lensMock.onStateChange?.({
        ...lensMock.state,
        sourceName: "paged.tiff",
        pageIndex: 1,
        pageCount: 2,
        pageWidth: 100,
        pageHeight: 200,
      });
    });

    await waitFor(() => expect(sessionDbMock.saveActiveViewerSession).toHaveBeenCalledTimes(2));
    expect(sessionDbMock.activeSession()).toMatchObject({
      fileName: "paged.tiff",
      pageIndex: 1,
    });
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

    expect(screen.getByText("Choose or drop one TIFF file at a time.")).toBeInTheDocument();
    expect(lensMock.instance.decodeTiff).not.toHaveBeenCalled();
    await waitFor(() => expect(sessionDbMock.deleteActiveViewerSession).toHaveBeenCalledTimes(1));
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
