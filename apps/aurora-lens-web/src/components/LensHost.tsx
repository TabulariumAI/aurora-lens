import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ReactViewer } from "@tabularium/aurora-lens/react";
import type { AuroraLens, ViewerReady } from "@tabularium/aurora-lens";
import { selectionTheme } from "../lens/selectionTheme";
import type { ViewerState, ViewerStatus } from "../lens/types";
import { AlertDialog } from "./AlertDialog";
import { ProgressBar } from "./ProgressBar";
import { ViewerFooter } from "./ViewerFooter";
import { ViewerToolbar } from "./ViewerToolbar";
import type { PageInfo } from "../lens/types";

interface LensHostProps {
  addError: string;
  allowEdit: boolean;
  fatalError: string;
  lensRef: RefObject<AuroraLens | null>;
  pageInfo: PageInfo | null;
  progressText: string;
  state: ViewerState;
  status: ViewerStatus;
  viewerError: string;
  onAddError: (error: Error) => void;
  onAddErrorOk: () => void;
  onError: (error: Error) => void;
  onFatalErrorOk: () => void;
  onReady: (viewer: ViewerReady) => void;
  onStateChange: (state: ViewerState) => void;
  onStatusChange: (status: ViewerStatus) => void;
  onViewerErrorOk: () => void;
}

export function LensHost({ addError, allowEdit, fatalError, lensRef, pageInfo, progressText, state, status, viewerError, onAddError, onAddErrorOk, onError, onFatalErrorOk, onReady, onStateChange, onStatusChange, onViewerErrorOk }: LensHostProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResultCount, setSearchResultCount] = useState<number | null>(null);
  const [indexOpen, setIndexOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const copyTimerRef = useRef(0);
  const isBusy = status === "addingPages" || status === "loadingPage" || status === "loadingThumbnails" || status === "copyingSelection";
  const indexes = pageInfo?.indexes ?? [];
  const indexKey = useMemo(() => JSON.stringify([
    pageInfo?.pageNumber ?? null,
    indexes.map((index) => [index.label, index.value, index.source, index.ambiguous]),
  ]), [indexes, pageInfo?.pageNumber]);

  useEffect(() => {
    return () => {
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [indexKey]);

  useEffect(() => {
    setSearchResultCount(null);
  }, [searchText]);

  const run = (action: () => unknown) => {
    try {
      const result = action();
      if (result instanceof Promise) {
        void result.catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return (
    <section className="viewer-stage" aria-label="Document preview">
      <div className="viewer-shell">
        <ViewerToolbar
          state={state}
          indexOpen={indexOpen}
          indexes={indexes}
          intelligenceColor={selectionTheme.intelligence}
          selectedIndex={selectedIndex}
          searchOpen={searchOpen}
          searchResultCount={searchResultCount}
          searchText={searchText}
          copyConfirmed={copyConfirmed}
          onActualSize={() => lensRef.current?.actualSize()}
          onClearSelection={() => lensRef.current?.clearSelection()}
          onCopySelection={() => run(async () => {
            const result = await lensRef.current?.copySelection();
            if (result?.copied) {
              setCopyConfirmed(true);
              window.clearTimeout(copyTimerRef.current);
              copyTimerRef.current = window.setTimeout(() => setCopyConfirmed(false), 1200);
            }
          })}
          onFitHeight={() => lensRef.current?.fitHeight()}
          onFitPage={() => lensRef.current?.fitPage()}
          onFitWidth={() => lensRef.current?.fitWidth()}
          onRunSearch={(additive) => {
            if (searchText.trim()) {
              run(() => {
                const hits = lensRef.current?.search(searchText, { additive });
                if (hits) {
                  setSearchResultCount(hits.tokens.length + hits.contexts.length + hits.figures.length);
                }
              });
            }
          }}
          onRunIndex={() => {
            const index = indexes[selectedIndex];
            if (index && pageInfo) {
              console.info("[HOST] index search", {
                pageNumber: pageInfo.pageNumber,
                selectedIndex,
                index,
              });
              run(() => lensRef.current?.searchIndex(pageInfo.pageNumber, index));
            }
          }}
          onSearchText={setSearchText}
          onSelectIndex={setSelectedIndex}
          onToggleDrawMode={() => lensRef.current?.setDrawMode(!state.drawMode)}
          onToggleIndexes={() => {
            setIndexOpen((current) => {
              const next = !current;
              if (next) {
                setSearchOpen(false);
                setSearchText("");
                setSearchResultCount(null);
              }
              return next;
            });
          }}
          onToggleSearch={() => {
            setSearchOpen((current) => {
              const next = !current;
              if (next) {
                setIndexOpen(false);
              } else {
                setSearchText("");
                setSearchResultCount(null);
              }
              return next;
            });
          }}
          onZoomIn={() => lensRef.current?.zoomIn()}
          onZoomOut={() => lensRef.current?.zoomOut()}
        />
        <div className="viewer-body">
          <ReactViewer
            ref={lensRef}
            allowEdit={allowEdit}
            selectionTheme={selectionTheme}
            onAddError={onAddError}
            onError={onError}
            onReady={onReady}
            onStateChange={onStateChange}
            onStatusChange={onStatusChange}
          />
          {status === "idle" && !viewerError ? <div className="viewer-message viewer-overlay">Choose, drop, or select a sample document.</div> : null}
          {isBusy ? (
            <div className="viewer-progress-overlay">
              <ProgressBar text={progressText} />
            </div>
          ) : null}
          {viewerError ? (
            <AlertDialog title="Document Error" message={viewerError} onOk={onViewerErrorOk} />
          ) : null}
          {fatalError ? (
            <AlertDialog title="Viewer Error" message={fatalError} onOk={onFatalErrorOk} />
          ) : null}
          {addError ? (
            <AlertDialog title="Add Pages Error" message={addError} onOk={onAddErrorOk} />
          ) : null}
        </div>
        <ViewerFooter
          state={state}
          onFirstPage={() => run(() => lensRef.current?.firstPage())}
          onLastPage={() => run(() => lensRef.current?.lastPage())}
          onNextPage={() => run(() => lensRef.current?.nextPage())}
          onPreviousPage={() => run(() => lensRef.current?.previousPage())}
          onShowThumbnails={() => run(() => lensRef.current?.showThumbnails())}
        />
      </div>
    </section>
  );
}
