import { useEffect, useMemo, useState } from "react";
import type { HostViewerStatus, PageSizeConfig, ViewerDetails } from "../lens/types";
import type { SelectionColor } from "../lens/types";

interface DetailsPanelProps {
  allowEdit: boolean;
  details: ViewerDetails;
  error: string;
  pageCount: number;
  status: HostViewerStatus;
  validationConfig: PageSizeConfig | null;
  onAllowEdit: (allowEdit: boolean) => void;
  onValidationConfig: (config: PageSizeConfig) => void;
}

export function DetailsPanel({ allowEdit, details, error, pageCount, status, validationConfig, onAllowEdit, onValidationConfig }: DetailsPanelProps) {
  const [draft, setDraft] = useState<PageSizeConfig | null>(null);

  useEffect(() => {
    setDraft(validationConfig ? copyConfig(validationConfig) : null);
  }, [validationConfig]);

  const dirty = useMemo(() => Boolean(validationConfig && draft && !sameConfig(validationConfig, draft)), [draft, validationConfig]);

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

      <section className="details-section" aria-labelledby="edit-details-heading">
        <h2 id="edit-details-heading">Edit</h2>
        <label className="edit-toggle">
          <input type="checkbox" checked={allowEdit} onChange={(event) => onAllowEdit(event.currentTarget.checked)} />
          <span>Edit pages</span>
        </label>
      </section>

      {draft ? (
        <section className="details-section" aria-labelledby="validation-details-heading">
          <h2 id="validation-details-heading">Validation</h2>
          <label className="validation-field">
            <span>Tolerance</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.tolerance}
              onChange={(event) => {
                if (Number.isFinite(event.currentTarget.valueAsNumber) && event.currentTarget.valueAsNumber >= 0) {
                  setDraft({
                    ...draft,
                    tolerance: event.currentTarget.valueAsNumber,
                  });
                }
              }}
            />
          </label>
          <div className="validation-grid" role="table" aria-label="Page validation formats">
            <div className="validation-head" role="columnheader">Format</div>
            <div className="validation-head" role="columnheader">Width</div>
            <div className="validation-head" role="columnheader">Height</div>
            {draft.formats.map((format, index) => (
              <ValidationRow
                format={format}
                key={format.name}
                onHeight={(height) => setDraft({
                  ...draft,
                  formats: draft.formats.map((value, valueIndex) => valueIndex === index ? { ...value, height } : value),
                })}
                onWidth={(width) => setDraft({
                  ...draft,
                  formats: draft.formats.map((value, valueIndex) => valueIndex === index ? { ...value, width } : value),
                })}
              />
            ))}
          </div>
          <div className="validation-actions">
            <button type="button" disabled={!dirty} onClick={() => onValidationConfig(draft)}>Save</button>
            <button type="button" disabled={!dirty} onClick={() => setDraft(validationConfig ? copyConfig(validationConfig) : null)}>Cancel</button>
          </div>
        </section>
      ) : null}

      {error ? <p className="error-box">{error}</p> : null}
    </aside>
  );
}

function copyConfig(config: PageSizeConfig): PageSizeConfig {
  return {
    formats: config.formats.map((format) => ({ ...format })),
    tolerance: config.tolerance,
  };
}

function sameConfig(left: PageSizeConfig, right: PageSizeConfig) {
  return left.tolerance === right.tolerance &&
    left.formats.length === right.formats.length &&
    left.formats.every((format, index) => {
      const value = right.formats[index];
      return value.name === format.name && value.width === format.width && value.height === format.height;
    });
}

function ValidationRow({ format, onHeight, onWidth }: { format: PageSizeConfig["formats"][number]; onHeight: (height: number) => void; onWidth: (width: number) => void }) {
  return (
    <>
      <div className="validation-label" role="rowheader">{format.name}</div>
      <input
        aria-label={`${format.name} width`}
        className="validation-input"
        type="number"
        min="0.01"
        step="0.01"
        value={format.width}
        onChange={(event) => {
          if (Number.isFinite(event.currentTarget.valueAsNumber) && event.currentTarget.valueAsNumber > 0) {
            onWidth(event.currentTarget.valueAsNumber);
          }
        }}
      />
      <input
        aria-label={`${format.name} height`}
        className="validation-input"
        type="number"
        min="0.01"
        step="0.01"
        value={format.height}
        onChange={(event) => {
          if (Number.isFinite(event.currentTarget.valueAsNumber) && event.currentTarget.valueAsNumber > 0) {
            onHeight(event.currentTarget.valueAsNumber);
          }
        }}
      />
    </>
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
