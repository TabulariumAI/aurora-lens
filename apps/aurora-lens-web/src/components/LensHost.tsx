import { useEffect, useRef, useState, type RefObject } from "react";
import { AuroraLensView } from "@tabularium/aurora-lens/react";
import type { AuroraLens, AuroraLensDecoder } from "@tabularium/aurora-lens";
import { selectionTheme } from "../lens/selectionTheme";
import type { AuroraLensState, AuroraLensStatus } from "../lens/types";
import { ProgressBar } from "./ProgressBar";
import { ViewerFooter } from "./ViewerFooter";
import { ViewerToolbar } from "./ViewerToolbar";

interface LensHostProps {
  decoder: AuroraLensDecoder;
  lensRef: RefObject<AuroraLens | null>;
  progressText: string;
  state: AuroraLensState;
  status: AuroraLensStatus;
  onError: (error: Error) => void;
  onStateChange: (state: AuroraLensState) => void;
  onStatusChange: (status: AuroraLensStatus) => void;
}

export function LensHost({ decoder, lensRef, progressText, state, status, onError, onStateChange, onStatusChange }: LensHostProps) {
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
          <AuroraLensView
            ref={lensRef}
            decoder={decoder}
            selectionTheme={selectionTheme}
            onError={onError}
            onStateChange={onStateChange}
            onStatusChange={onStatusChange}
            onThumbnailSelect={(pageIndex) => run(() => lensRef.current?.goToPage(pageIndex))}
          />
          {status === "idle" ? <div className="viewer-message viewer-overlay">Choose, drop, or select a sample TIFF file.</div> : null}
          {isBusy ? (
            <div className="viewer-message viewer-overlay">
              <ProgressBar text={progressText} />
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
