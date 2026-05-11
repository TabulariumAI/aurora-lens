import type { AuroraLensState } from "../lens/types";
import type { MouseEvent } from "react";
import { ViewerIcon, type ViewerIconName } from "./ViewerIcon";

interface ViewerToolbarProps {
  state: AuroraLensState;
  searchOpen: boolean;
  searchText: string;
  copyConfirmed: boolean;
  onActualSize: () => void;
  onClearSelection: () => void;
  onCopySelection: () => void;
  onFitHeight: () => void;
  onFitPage: () => void;
  onFitWidth: () => void;
  onRunSearch: (additive: boolean) => void;
  onSearchText: (value: string) => void;
  onToggleDrawMode: () => void;
  onToggleSearch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function ViewerToolbar({
  state,
  searchOpen,
  searchText,
  copyConfirmed,
  onActualSize,
  onClearSelection,
  onCopySelection,
  onFitHeight,
  onFitPage,
  onFitWidth,
  onRunSearch,
  onSearchText,
  onToggleDrawMode,
  onToggleSearch,
  onZoomIn,
  onZoomOut,
}: ViewerToolbarProps) {
  const pageActive = state.viewMode === "page";

  return (
    <div className="viewer-toolbar">
      <div className="viewer-toolbar-group">
        {!searchOpen ? (
          <IconButton icon="search" title="Search" tone="intelligence" disabled={!pageActive || !state.canSearch} onClick={onToggleSearch} />
        ) : null}
        {searchOpen ? (
          <>
            <input
              className="viewer-search-input"
              type="text"
              title="Search text"
              value={searchText}
              onChange={(event) => onSearchText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onRunSearch(event.ctrlKey);
                } else if (event.key === "Escape") {
                  onToggleSearch();
                }
              }}
            />
            <IconButton icon="search" title="Search text" disabled={!pageActive || !state.canSearch || !searchText.trim()} onClick={(event) => onRunSearch(event.ctrlKey)} />
          </>
        ) : null}
        <IconButton icon="rect" title="Draw rectangle" tone="intelligence" pressed={state.drawMode} disabled={!pageActive || !state.canDraw} onClick={onToggleDrawMode} />
        <IconButton icon="clear" title="Clear selected document elements" disabled={!pageActive || !state.canClearSelection} onClick={onClearSelection} />
        <IconButton icon={copyConfirmed ? "check" : "copy"} title="Copy selected words" tone="intelligence" disabled={!pageActive || !state.canCopy} onClick={onCopySelection} />
        <span className="viewer-toolbar-separator" aria-hidden="true" />
        <IconButton icon="zoom-out" title="Zoom out" disabled={!pageActive || !state.canZoomOut} onClick={onZoomOut} />
        <IconButton icon="zoom-in" title="Zoom in" disabled={!pageActive || !state.canZoomIn} onClick={onZoomIn} />
        <IconButton icon="fit-width" title="Fit width" disabled={!pageActive || !state.canFitWidth} onClick={onFitWidth} />
        <IconButton icon="fit-height" title="Fit height" disabled={!pageActive || !state.canFitHeight} onClick={onFitHeight} />
        <IconButton icon="fit" title="Best fit" disabled={!pageActive || !state.canFitPage} onClick={onFitPage} />
        <IconButton icon="actual-size" title="Actual size" disabled={!pageActive || !state.canActualSize} onClick={onActualSize} />
      </div>
      {state.canSearch ? (
        <div className="viewer-intelligence-chip" aria-label="Intelligence ready">
          <span aria-hidden="true" />
          Intelligence ready
        </div>
      ) : null}
      <div className="viewer-zoom-label">{Math.round(state.zoom * 100)}%</div>
    </div>
  );
}

interface IconButtonProps {
  disabled?: boolean;
  icon: ViewerIconName;
  pressed?: boolean;
  tone?: "default" | "intelligence";
  title: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function IconButton({ disabled = false, icon, pressed, tone = "default", title, onClick }: IconButtonProps) {
  return (
    <button
      className={`viewer-tool-button${tone === "intelligence" ? " is-intelligence" : ""}`}
      type="button"
      aria-label={title}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <ViewerIcon name={icon} />
    </button>
  );
}
