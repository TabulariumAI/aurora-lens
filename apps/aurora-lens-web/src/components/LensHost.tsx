import { useEffect, useRef, useState, type RefObject } from "react";
import { ReactViewer } from "@tabularium/aurora-lens/react";
import type { AuroraLens, ViewerDecoder, ViewerReady } from "@tabularium/aurora-lens";
import { selectionTheme } from "../lens/selectionTheme";
import type { ViewerState, ViewerStatus } from "../lens/types";
import { ProgressBar } from "./ProgressBar";
import { ViewerFooter } from "./ViewerFooter";
import { ViewerToolbar } from "./ViewerToolbar";

interface LensHostProps {
  allowEdit: boolean;
  decoder: ViewerDecoder;
  fatalError: string;
  lensRef: RefObject<AuroraLens | null>;
  progressText: string;
  state: ViewerState;
  status: ViewerStatus;
  onError: (error: Error) => void;
  onFatalErrorOk: () => void;
  onReady: (viewer: ViewerReady) => void;
  onStateChange: (state: ViewerState) => void;
  onStatusChange: (status: ViewerStatus) => void;
}

export function LensHost({ allowEdit, decoder, fatalError, lensRef, progressText, state, status, onError, onFatalErrorOk, onReady, onStateChange, onStatusChange }: LensHostProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const copyTimerRef = useRef(0);
  const isBusy = status === "loadingPage" || status === "loadingThumbnails" || status === "copyingSelection";

  useEffect(() => {
    return () => {
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

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
          searchOpen={searchOpen}
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
              run(() => lensRef.current?.search(searchText, { additive }));
            }
          }}
          onSearchText={setSearchText}
          onToggleDrawMode={() => lensRef.current?.setDrawMode(!state.drawMode)}
          onToggleSearch={() => {
            setSearchOpen((current) => !current);
            if (searchOpen) {
              setSearchText("");
            }
          }}
          onZoomIn={() => lensRef.current?.zoomIn()}
          onZoomOut={() => lensRef.current?.zoomOut()}
        />
        <div className="viewer-body">
          <ReactViewer
            ref={lensRef}
            allowEdit={allowEdit}
            decoder={decoder}
            selectionTheme={selectionTheme}
            onError={onError}
            onReady={onReady}
            onStateChange={onStateChange}
            onStatusChange={onStatusChange}
          />
          {status === "idle" ? <div className="viewer-message viewer-overlay">Choose, drop, or select a sample TIFF file.</div> : null}
          {isBusy ? (
            <div className="viewer-message viewer-overlay">
              <ProgressBar text={progressText} />
            </div>
          ) : null}
          {fatalError ? (
            <div className="viewer-message viewer-overlay viewer-error-overlay" role="alertdialog" aria-modal="true" aria-labelledby="viewer-fatal-error-heading">
              <div className="viewer-error-dialog">
                <h2 id="viewer-fatal-error-heading">Viewer Error</h2>
                <p>{fatalError}</p>
                <button type="button" onClick={onFatalErrorOk}>OK</button>
              </div>
            </div>
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
