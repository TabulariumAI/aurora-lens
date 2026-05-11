import type { ViewerState } from "../lens/types";
import { ViewerIcon, type ViewerIconName } from "./ViewerIcon";

interface ViewerFooterProps {
  state: ViewerState;
  onFirstPage: () => void;
  onLastPage: () => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onShowThumbnails: () => void;
}

export function ViewerFooter({ state, onFirstPage, onLastPage, onNextPage, onPreviousPage, onShowThumbnails }: ViewerFooterProps) {
  const pageText = state.pageCount > 0 && state.pageIndex >= 0
    ? `Page ${state.pageIndex + 1} of ${state.pageCount}`
    : "Page 0 of 0";

  return (
    <div className="viewer-footer">
      <div className="viewer-page-counter">{pageText}</div>
      <span className="viewer-footer-spacer" />
      <FooterButton icon="thumbnails" title="All thumbnails" disabled={!state.canShowThumbnails || state.viewMode === "thumbnails"} onClick={onShowThumbnails} />
      <FooterButton icon="first" title="First page" disabled={!state.canGoFirst} onClick={onFirstPage} />
      <FooterButton icon="prev" title="Previous page" disabled={!state.canGoPrevious} onClick={onPreviousPage} />
      <FooterButton icon="next" title="Next page" disabled={!state.canGoNext} onClick={onNextPage} />
      <FooterButton icon="last" title="Last page" disabled={!state.canGoLast} onClick={onLastPage} />
    </div>
  );
}

interface FooterButtonProps {
  disabled?: boolean;
  icon: ViewerIconName;
  title: string;
  onClick: () => void;
}

function FooterButton({ disabled = false, icon, title, onClick }: FooterButtonProps) {
  return (
    <button className="viewer-tool-button" type="button" aria-label={title} title={title} disabled={disabled} onClick={onClick}>
      <ViewerIcon name={icon} />
    </button>
  );
}
