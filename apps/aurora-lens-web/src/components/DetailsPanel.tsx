import type { HostViewerStatus, ViewerDetails } from "../lens/types";
import type { SelectionColor } from "../lens/types";

interface DetailsPanelProps {
  details: ViewerDetails;
  error: string;
  pageCount: number;
  status: HostViewerStatus;
}

export function DetailsPanel({ details, error, pageCount, status }: DetailsPanelProps) {
  return (
    <aside className="details-panel" aria-label="Page details">
      <div className="details-heading">
        <span>Page Details</span>
        <strong>{status === "loading" ? "Decoding" : `${pageCount} page${pageCount === 1 ? "" : "s"}`}</strong>
      </div>

      <section className="details-section" aria-labelledby="document-details-heading">
        <h2 id="document-details-heading">Document</h2>
        <dl>
          <dt>Source</dt>
          <dd>{details.source}</dd>
          <dt>Page</dt>
          <dd>{details.page}</dd>
          <dt>Size</dt>
          <dd>{details.size}</dd>
          <dt>Zoom</dt>
          <dd>{details.zoom}</dd>
        </dl>
      </section>

      <section className="details-section" aria-labelledby="selection-details-heading">
        <h2 id="selection-details-heading">Selection</h2>
        <dl>
          <dt>Tokens</dt>
          <dd>{details.tokens}</dd>
          <dt>Figures</dt>
          <dd>{details.figures}</dd>
          <dt>Context</dt>
          <dd>{details.context}</dd>
        </dl>
      </section>

      <section className="details-section" aria-labelledby="style-details-heading">
        <h2 id="style-details-heading">Style</h2>
        <div className="theme-grid" role="table" aria-label="Selection style">
          <div className="theme-head" role="columnheader" />
          <div className="theme-head" role="columnheader">Fill</div>
          <div className="theme-head" role="columnheader">Border</div>
          <StyleRow label="Context" colors={details.theme.context} />
          <StyleRow label="Figure" colors={details.theme.figure} />
          <StyleRow label={`High ${details.theme.confidence.high}`} colors={details.theme.tokenHigh} />
          <StyleRow label={`Medium ${details.theme.confidence.medium}`} colors={details.theme.tokenMedium} />
          <StyleRow label={`Low ${details.theme.confidence.low}`} colors={details.theme.tokenLow} />
        </div>
      </section>

      {error ? <p className="error-box">{error}</p> : null}
    </aside>
  );
}

function StyleRow({ label, colors }: { label: string; colors: SelectionColor }) {
  return (
    <>
      <div className="theme-label" role="rowheader">{label}</div>
      <ColorSwatch label={`${label} fill ${colors.fill}`} color={colors.fill} />
      <ColorSwatch label={`${label} border ${colors.stroke}`} color={colors.stroke} />
    </>
  );
}

function ColorSwatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="theme-cell" role="cell">
      <span className="theme-swatch" aria-label={label} title={label} style={{ background: color, borderColor: color }} />
    </div>
  );
}
