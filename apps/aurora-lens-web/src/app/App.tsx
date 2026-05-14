import { useCallback, useMemo, useRef, useState } from "react";
import {
  DECODER_ERROR_EMPTY_DOCUMENT,
  DECODER_ERROR_PAGE_OUT_OF_RANGE,
  DECODER_ERROR_PAGE_SIZE,
  DECODER_ERROR_RASTER_LIMIT,
  DECODER_ERROR_UNSUPPORTED_FORMAT,
  DECODER_ERROR_UNKNOWN,
  DECODER_ERROR_UNREADABLE_DOCUMENT,
  defaultViewerConfig,
  isDecoderError,
  type AuroraLens,
  type DecoderErrorCode,
  type ViewerConfig,
  type ViewerReady,
} from "@tabularium/aurora-lens";
import { DetailsPanel } from "../components/DetailsPanel";
import { LensHost } from "../components/LensHost";
import { LoaderPanel } from "../components/LoaderPanel";
import { selectionTheme } from "../lens/selectionTheme";
import { VIEWER_SAMPLES, type ViewerSample } from "../samples";
import type { ViewerState, ViewerStatus, HostViewerStatus, ViewerDetails } from "../lens/types";

const TIFF_FILE_TYPE = "image/tiff";
const TIFF_EXTENSION = ".tif";
const mainDocumentErrorMessages: Record<Exclude<DecoderErrorCode, typeof DECODER_ERROR_PAGE_SIZE>, string> = {
  [DECODER_ERROR_EMPTY_DOCUMENT]: "This document does not contain readable pages.",
  [DECODER_ERROR_PAGE_OUT_OF_RANGE]: "The requested page is outside the document.",
  [DECODER_ERROR_RASTER_LIMIT]: "This PDF page exceeds configured view raster limits.",
  [DECODER_ERROR_UNSUPPORTED_FORMAT]: "Choose a TIFF, PDF, PNG, or JPG file.",
  [DECODER_ERROR_UNKNOWN]: "We could not open this document.",
  [DECODER_ERROR_UNREADABLE_DOCUMENT]: "This document could not be read.",
};

const emptyLensState: ViewerState = {
  viewMode: "page",
  status: "idle",
  sourceName: null,
  pageIndex: -1,
  pageCount: 0,
  metadataPageCount: 0,
  pageInfo: null,
  pageWidth: null,
  pageHeight: null,
  zoom: 1,
  coordinates: null,
  displayCoordinates: null,
  selectionCounts: {
    tokens: 0,
    figures: 0,
    context: 0,
  },
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
};

interface ResolvedViewerInput {
  file: File;
  metadata: unknown | null;
}

export function App() {
  const [lensState, setLensState] = useState<ViewerState>(emptyLensState);
  const [lensStatus, setLensStatus] = useState<ViewerStatus>("idle");
  const [allowEdit, setAllowEdit] = useState(true);
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig | null>(null);
  const [error, setError] = useState("");
  const [addError, setAddError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [viewerError, setViewerError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lensRef = useRef<AuroraLens | null>(null);
  const operationIdRef = useRef(0);

  const resetViewerState = useCallback((clearInput: boolean) => {
    lensRef.current?.clear();
    setLensState(emptyLensState);
    setLensStatus("idle");
    setError("");
    setAddError("");
    setExporting(false);
    setViewerError("");
    if (clearInput && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const beginViewerOperation = useCallback(() => {
    operationIdRef.current += 1;
    return operationIdRef.current;
  }, []);

  const isViewerOperationCurrent = useCallback((operationId: number) => operationIdRef.current === operationId, []);

  const restoreViewerSession = useCallback((viewer: ViewerReady) => {
    void viewer.readViewerConfig()
      .then(setViewerConfig)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    void viewer.restoreSession();
  }, []);

  const updateViewerState = useCallback((state: ViewerState) => {
    setLensState(state);
  }, []);

  const saveViewerConfig = useCallback((config: ViewerConfig) => {
    void lensRef.current?.saveViewerConfig(config)
      .then(setViewerConfig)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const exportTiff = useCallback(() => {
    const lens = lensRef.current;
    const sourceName = lensState.sourceName;
    if (!lens || !sourceName) {
      setError("Open a document before exporting.");
      return;
    }
    setExporting(true);
    void lens.exportTiff()
      .then((blob) => {
        const dot = sourceName.lastIndexOf(".");
        const fileName = `${dot > 0 ? sourceName.slice(0, dot) : sourceName}${TIFF_EXTENSION}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setExporting(false));
  }, [lensState.sourceName]);

  const acknowledgeFatalError = useCallback(() => {
    beginViewerOperation();
    resetViewerState(true);
  }, [beginViewerOperation, resetViewerState]);

  const loadResolvedInput = useCallback(async (input: ResolvedViewerInput, operationId: number) => {
    if (!isViewerOperationCurrent(operationId)) {
      return;
    }

    const lens = lensRef.current;
    if (!lens) {
      setError("Tabularium AI Lens is not ready.");
      return;
    }

    resetViewerState(false);
    try {
      if (input.metadata !== null) {
        await lens.loadMetadata(input.metadata);
        if (!isViewerOperationCurrent(operationId)) {
          return;
        }
      }

      await lens.decodeDoc(input.file, 0);
      if (!isViewerOperationCurrent(operationId)) {
        return;
      }

    } catch (reason: unknown) {
      if (!isViewerOperationCurrent(operationId) || (reason instanceof DOMException && reason.name === "AbortError")) {
        return;
      }
      resetViewerState(false);
      setViewerError(mainDocumentErrorMessage(reason));
    }
  }, [isViewerOperationCurrent, resetViewerState]);

  const loadFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList || []);
    if (!files.length) {
      beginViewerOperation();
      resetViewerState(false);
      return;
    }
    if (files.length > 1) {
      beginViewerOperation();
      setViewerError("Choose or drop one document at a time.");
      return;
    }

    const operationId = beginViewerOperation();
    void loadResolvedInput({ file: files[0], metadata: null }, operationId);
  }, [beginViewerOperation, loadResolvedInput, resetViewerState]);

  const loadSample = useCallback((sample: ViewerSample) => {
    const operationId = beginViewerOperation();
    resetViewerState(true);
    void (async () => {
      const [metadataResponse, tiffResponse] = await Promise.all([
        fetch(sample.metadataUrl),
        fetch(sample.tiffUrl),
      ]);
      if (!metadataResponse.ok) {
        throw new Error(`Could not load ${sample.metadataUrl}.`);
      }
      if (!tiffResponse.ok) {
        throw new Error(`Could not load ${sample.tiffUrl}.`);
      }
      const metadata = await metadataResponse.json();
      const blob = await tiffResponse.blob();
      if (!isViewerOperationCurrent(operationId)) {
        return;
      }

      await loadResolvedInput({
        file: new File([blob], sample.tiffName, { type: TIFF_FILE_TYPE }),
        metadata,
      }, operationId);
    })().catch(async (reason: unknown) => {
      if (!isViewerOperationCurrent(operationId) || (reason instanceof DOMException && reason.name === "AbortError")) {
        return;
      }
      setViewerError(mainDocumentErrorMessage(reason));
    });
  }, [beginViewerOperation, isViewerOperationCurrent, loadResolvedInput, resetViewerState]);

  const hostStatus = useMemo<HostViewerStatus>(() => toHostStatus(lensStatus, lensState), [lensState, lensStatus]);
  const details = useMemo(() => toDetails(lensState), [lensState]);
  const progressText = useMemo(() => toProgressText(lensStatus, lensState), [lensState, lensStatus]);

  return (
    <main className="app-shell">
      <section className="workspace" aria-label="Document viewer workspace">
        <LoaderPanel
          disabled={lensStatus === "loadingPage" || lensStatus === "loadingThumbnails"}
          fileInputRef={fileInputRef}
          samples={VIEWER_SAMPLES}
          onFiles={loadFiles}
          onSample={loadSample}
        />
        <LensHost
          addError={addError}
          allowEdit={allowEdit}
          fatalError={lensStatus === "error" ? error : ""}
          lensRef={lensRef}
          pageInfo={lensState.pageInfo}
          progressText={progressText}
          state={lensState}
          status={lensStatus}
          viewerError={viewerError}
          onAddError={(reason) => setAddError(addPagesErrorMessage(reason))}
          onAddErrorOk={() => setAddError("")}
          onError={(reason) => setError(reason.message)}
          onFatalErrorOk={acknowledgeFatalError}
          onViewerErrorOk={() => setViewerError("")}
          onReady={restoreViewerSession}
          onStateChange={updateViewerState}
          onStatusChange={setLensStatus}
        />
        <DetailsPanel
          allowEdit={allowEdit}
          canExport={lensState.pageCount > 0 && hostStatus === "ready"}
          defaultConfig={defaultViewerConfig()}
          details={details}
          error={error}
          exporting={exporting}
          pageCount={lensState.pageCount}
          status={hostStatus}
          viewerConfig={viewerConfig}
          onAllowEdit={setAllowEdit}
          onExport={exportTiff}
          onViewerConfig={saveViewerConfig}
        />
      </section>
    </main>
  );
}

function toHostStatus(status: ViewerStatus, state: ViewerState): HostViewerStatus {
  if (status === "loadingPage" || status === "loadingThumbnails" || status === "copyingSelection") {
    return "loading";
  }
  if (state.pageCount > 0) {
    return "ready";
  }
  return "empty";
}

function toDetails(state: ViewerState): ViewerDetails {
  return {
    source: state.sourceName || "None",
    page: state.pageCount > 0 && state.pageIndex >= 0 ? `${state.pageIndex + 1} of ${state.pageCount}` : "None",
    size: state.pageWidth && state.pageHeight ? `${state.pageWidth} x ${state.pageHeight}` : "None",
    zoom: `${Math.round(state.zoom * 100)}%`,
    info: state.pageInfo,
    tokens: String(state.selectionCounts.tokens),
    figures: String(state.selectionCounts.figures),
    context: String(state.selectionCounts.context),
    theme: {
      context: selectionTheme.context,
      figure: selectionTheme.figure,
      tokenHigh: selectionTheme.token.high,
      tokenMedium: selectionTheme.token.medium,
      tokenLow: selectionTheme.token.low,
      confidence: {
        high: `>=${selectionTheme.confidence.high}%`,
        medium: `>=${selectionTheme.confidence.medium}%`,
        low: `<${selectionTheme.confidence.medium}%`,
      },
    },
  };
}

function toProgressText(status: ViewerStatus, state: ViewerState) {
  if (status === "loadingPage") {
    return state.pageCount > 0 ? "Loading page..." : "Decoding document page...";
  }
  if (status === "copyingSelection") {
    return "Copying selection...";
  }
  return "Loading...";
}

function mainDocumentErrorMessage(error: unknown) {
  if (!isDecoderError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.code === DECODER_ERROR_PAGE_SIZE) {
    return error.message;
  }
  return mainDocumentErrorMessages[error.code];
}

function addPagesErrorMessage(error: unknown) {
  if (!isDecoderError(error)) {
    return "We could not add those pages.";
  }
  if (error.code === DECODER_ERROR_PAGE_SIZE) {
    return "Some pages did not match the configured page size. The pages that loaded successfully were kept.";
  }
  if (error.code === DECODER_ERROR_RASTER_LIMIT) {
    return "Some PDF pages exceeded configured view raster limits. The pages that loaded successfully were kept.";
  }
  return "Some pages could not be added. The pages that loaded successfully were kept.";
}
