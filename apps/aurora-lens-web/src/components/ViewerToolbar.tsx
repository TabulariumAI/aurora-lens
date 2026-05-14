import type { MetadataIndex, SelectionColor, ViewerState } from "../lens/types";
import type { CSSProperties, MouseEvent } from "react";
import { ViewerIcon, type ViewerIconName } from "./ViewerIcon";

interface ViewerToolbarProps {
  state: ViewerState;
  indexOpen: boolean;
  indexes: MetadataIndex[];
  intelligenceColor: SelectionColor;
  selectedIndex: number;
  searchOpen: boolean;
  searchResultCount: number | null;
  searchText: string;
  copyConfirmed: boolean;
  onActualSize: () => void;
  onClearSelection: () => void;
  onCopySelection: () => void;
  onFitHeight: () => void;
  onFitPage: () => void;
  onFitWidth: () => void;
  onRunSearch: (additive: boolean) => void;
  onRunIndex: () => void;
  onSearchText: (value: string) => void;
  onSelectIndex: (index: number) => void;
  onToggleDrawMode: () => void;
  onToggleIndexes: () => void;
  onToggleSearch: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function ViewerToolbar({
  state,
  indexOpen,
  indexes,
  intelligenceColor,
  selectedIndex,
  searchOpen,
  searchResultCount,
  searchText,
  copyConfirmed,
  onActualSize,
  onClearSelection,
  onCopySelection,
  onFitHeight,
  onFitPage,
  onFitWidth,
  onRunSearch,
  onRunIndex,
  onSearchText,
  onSelectIndex,
  onToggleDrawMode,
  onToggleIndexes,
  onToggleSearch,
  onZoomIn,
  onZoomOut,
}: ViewerToolbarProps) {
  const pageActive = state.viewMode === "page";
  const intelligence = intelligenceStatus(state.metadataPageCount, state.pageCount);
  const searchFailed = searchResultCount === 0;
  const toolbarStyle = {
    "--viewer-intelligence-fill": intelligenceColor.fill,
    "--viewer-intelligence-stroke": intelligenceColor.stroke,
  } as CSSProperties;

  return (
    <div className="viewer-toolbar" style={toolbarStyle}>
      <div className="viewer-toolbar-group">
        {!searchOpen ? (
          <IconButton icon="search" title="Search" disabled={!pageActive || !state.canSearch} onClick={onToggleSearch} />
        ) : null}
        {searchOpen ? (
          <>
            <input
              className={`viewer-search-input${searchFailed ? " has-no-results" : ""}`}
              type="text"
              aria-invalid={searchFailed}
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
        {!indexOpen ? (
          <IconButton icon="indexes" title="Search indexes" disabled={!pageActive || !state.canSearch || !indexes.length} onClick={onToggleIndexes} />
        ) : null}
        {indexOpen ? (
          <>
            <select
              className="viewer-index-select"
              title="Document index"
              aria-label="Document index"
              value={selectedIndex}
              disabled={!pageActive || !state.canSearch || !indexes.length}
              onChange={(event) => onSelectIndex(Number(event.currentTarget.value))}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onToggleIndexes();
                }
              }}
            >
              {indexes.map((index, optionIndex) => (
                <option key={`${index.label}\n${index.value}\n${index.source}`} value={optionIndex}>
                  {index.label}: {index.value}
                </option>
              ))}
            </select>
            <IconButton icon="go" title="Go to selected index" disabled={!pageActive || !state.canSearch || !indexes.length} onClick={onRunIndex} />
          </>
        ) : null}
        <IconButton icon="rect" title="Draw rectangle" pressed={state.drawMode} disabled={!pageActive || !state.canDraw} onClick={onToggleDrawMode} />
        <IconButton icon="clear" title="Clear selected document elements" disabled={!pageActive || !state.canClearSelection} onClick={onClearSelection} />
        <IconButton icon={copyConfirmed ? "check" : "copy"} title="Copy selected words" disabled={!pageActive || !state.canCopy} onClick={onCopySelection} />
        <span className="viewer-toolbar-separator" aria-hidden="true" />
        <IconButton icon="zoom-out" title="Zoom out" disabled={!pageActive || !state.canZoomOut} onClick={onZoomOut} />
        <IconButton icon="zoom-in" title="Zoom in" disabled={!pageActive || !state.canZoomIn} onClick={onZoomIn} />
        <IconButton icon="fit-width" title="Fit width" disabled={!pageActive || !state.canFitWidth} onClick={onFitWidth} />
        <IconButton icon="fit-height" title="Fit height" disabled={!pageActive || !state.canFitHeight} onClick={onFitHeight} />
        <IconButton icon="fit" title="Best fit" disabled={!pageActive || !state.canFitPage} onClick={onFitPage} />
        <IconButton icon="actual-size" title="Actual size" disabled={!pageActive || !state.canActualSize} onClick={onActualSize} />
      </div>
      {intelligence ? (
        <div className={`viewer-intelligence-chip${intelligence.ready ? "" : " is-partial"}`} aria-label={intelligence.label}>
          <span aria-hidden="true" />
          {intelligence.text}
        </div>
      ) : null}
      <div className="viewer-zoom-label">{Math.round(state.zoom * 100)}%</div>
    </div>
  );
}

function intelligenceStatus(metadataPageCount: number | undefined, pageCount: number) {
  if (pageCount <= 0 || metadataPageCount === undefined || metadataPageCount <= 0) {
    return null;
  }
  if (metadataPageCount === pageCount) {
    return {
      label: "Intelligence ready",
      ready: true,
      text: "Intelligence ready",
    };
  }
  return {
    label: `Intelligence metadata exists for ${metadataPageCount} of ${pageCount} document pages`,
    ready: false,
    text: `Partial intelligence ${metadataPageCount}/${pageCount}`,
  };
}

interface IconButtonProps {
  disabled?: boolean;
  icon: ViewerIconName;
  pressed?: boolean;
  title: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

function IconButton({ disabled = false, icon, pressed, title, onClick }: IconButtonProps) {
  return (
    <button
      className="viewer-tool-button"
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
