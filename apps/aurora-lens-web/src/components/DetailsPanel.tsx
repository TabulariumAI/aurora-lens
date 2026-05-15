import { useEffect, useId, useMemo, useState } from "react";
import { TIFF_PIXEL_FORMAT_BW1, TIFF_PIXEL_FORMAT_GRAY8, TIFF_PIXEL_FORMAT_RGB24 } from "@tabularium/aurora-lens";
import type { HostViewerStatus, ViewerConfig, ViewerDetails } from "../lens/types";
import type { SelectionColor } from "../lens/types";

interface DetailsPanelProps {
  allowEdit: boolean;
  canExport: boolean;
  details: ViewerDetails;
  error: string;
  exporting: boolean;
  defaultConfig: ViewerConfig;
  pageCount: number;
  status: HostViewerStatus;
  viewerConfig: ViewerConfig | null;
  onAllowEdit: (allowEdit: boolean) => void;
  onExport: () => void;
  onViewerConfig: (config: ViewerConfig) => void;
}

export function DetailsPanel({ allowEdit, canExport, defaultConfig, details, error, exporting, pageCount, status, viewerConfig, onAllowEdit, onExport, onViewerConfig }: DetailsPanelProps) {
  const [draft, setDraft] = useState<ViewerConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setDraft(viewerConfig ? copyConfig(viewerConfig) : null);
  }, [viewerConfig]);

  const dirty = useMemo(() => Boolean(viewerConfig && draft && !sameConfig(viewerConfig, draft)), [draft, viewerConfig]);

  return (
    <aside className="details-panel" aria-label="Page details">
      <section className="details-section" aria-labelledby="document-details-heading">
        <h2 id="document-details-heading">Document</h2>
        <dl>
          <dt>Source</dt>
          <dd>{details.source}</dd>
        </dl>
        <div className="details-actions">
          <button type="button" className="settings-button" disabled={!canExport || exporting} onClick={onExport}>
            {exporting ? <span className="export-spinner" aria-hidden="true" /> : null}
            {exporting ? "Exporting TIFF" : "Download TIFF"}
          </button>
          {draft ? (
            <button type="button" className="settings-button" onClick={() => setSettingsOpen(true)}>Image Settings</button>
          ) : null}
        </div>
      </section>

      <section className="details-section page-section" aria-labelledby="page-details-heading">
        <h2 id="page-details-heading">Page</h2>
        <label className="edit-toggle">
          <input type="checkbox" checked={allowEdit} onChange={(event) => onAllowEdit(event.currentTarget.checked)} />
          <span>Edit pages</span>
        </label>
        <dl>
          <dt>Page</dt>
          <dd>{details.page}</dd>
          <dt>Size</dt>
          <dd>{details.size}</dd>
          <dt>Zoom</dt>
          <dd>{details.zoom}</dd>
        </dl>

        {details.info ? (
          <section className="details-subsection" aria-labelledby="page-info-heading">
            <h3 id="page-info-heading">Page Info</h3>
            <dl>
              <dt>Number</dt>
              <dd>{details.info.pageNumber}</dd>
              <dt>Class</dt>
              <dd>{details.info.class ?? "None"}</dd>
              <dt>Segments</dt>
              <dd>{details.info.segments.length ? details.info.segments.join(", ") : "None"}</dd>
            </dl>
          </section>
        ) : null}

        <section className="details-subsection" aria-labelledby="selection-details-heading">
          <h3 id="selection-details-heading">Selection</h3>
          <dl>
            <dt>Tokens</dt>
            <dd>{details.tokens}</dd>
            <dt>Figures</dt>
            <dd>{details.figures}</dd>
            <dt>Context</dt>
            <dd>{details.context}</dd>
          </dl>
        </section>

        <section className="details-subsection" aria-labelledby="style-details-heading">
          <h3 id="style-details-heading">Style</h3>
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
      </section>

      {settingsOpen && draft ? (
        <ValidationDialog
          dirty={dirty}
          defaultConfig={defaultConfig}
          draft={draft}
          viewerConfig={viewerConfig}
          onClose={() => {
            setDraft(viewerConfig ? copyConfig(viewerConfig) : null);
            setSettingsOpen(false);
          }}
          onDraft={setDraft}
          onSave={() => {
            onViewerConfig(draft);
            setSettingsOpen(false);
          }}
        />
      ) : null}

      {error ? <p className="error-box">{error}</p> : null}
    </aside>
  );
}

function ValidationDialog({ defaultConfig, dirty, draft, viewerConfig, onClose, onDraft, onSave }: {
  defaultConfig: ViewerConfig;
  dirty: boolean;
  draft: ViewerConfig;
  viewerConfig: ViewerConfig | null;
  onClose: () => void;
  onDraft: (config: ViewerConfig) => void;
  onSave: () => void;
}) {
  const titleId = useId();

  return (
    <div className="settings-overlay" role="presentation">
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="settings-heading">
          <h2 id={titleId}>Image Settings</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="settings-body">
          <section className="settings-section" aria-label="Validation">
            <label className="validation-field">
              <span>Tolerance</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.tolerance}
                onChange={(event) => {
                  if (Number.isFinite(event.currentTarget.valueAsNumber) && event.currentTarget.valueAsNumber >= 0) {
                    onDraft({
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
                  onHeight={(height) => onDraft({
                    ...draft,
                    formats: draft.formats.map((value, valueIndex) => valueIndex === index ? { ...value, height } : value),
                  })}
                  onWidth={(width) => onDraft({
                    ...draft,
                    formats: draft.formats.map((value, valueIndex) => valueIndex === index ? { ...value, width } : value),
                  })}
                />
              ))}
            </div>
          </section>
          <RasterFields
            label="View"
            raster={draft.view}
            onRaster={(view) => onDraft({ ...draft, view })}
          />
          <RasterFields
            label="Export"
            raster={draft.export}
            onRaster={(exportConfig) => onDraft({ ...draft, export: exportConfig })}
          />
        </div>
        <div className="settings-actions">
          <button type="button" disabled={sameConfig(draft, defaultConfig)} onClick={() => onDraft(copyConfig(defaultConfig))}>Reset</button>
          <button type="button" disabled={!dirty} onClick={onSave}>Save</button>
          <button type="button" disabled={!dirty} onClick={() => onDraft(viewerConfig ? copyConfig(viewerConfig) : draft)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function copyConfig(config: ViewerConfig): ViewerConfig {
  return {
    formats: config.formats.map((format) => ({ ...format })),
    tolerance: config.tolerance,
    view: { ...config.view },
    export: {
      ...config.export,
      tiff: { ...config.export.tiff },
    },
  };
}

function sameConfig(left: ViewerConfig, right: ViewerConfig) {
  return left.tolerance === right.tolerance &&
    sameRaster(left.view, right.view) &&
    sameRaster(left.export, right.export) &&
    left.formats.length === right.formats.length &&
    left.formats.every((format, index) => {
      const value = right.formats[index];
      return value.name === format.name && value.width === format.width && value.height === format.height;
    });
}

function sameRaster(left: ViewerConfig["view"] | ViewerConfig["export"], right: ViewerConfig["view"] | ViewerConfig["export"]) {
  const leftTiff = "tiff" in left ? left.tiff : null;
  const rightTiff = "tiff" in right ? right.tiff : null;
  return left.pdfRasterDpi === right.pdfRasterDpi &&
    left.maxRasterPixels === right.maxRasterPixels &&
    left.maxRasterWidth === right.maxRasterWidth &&
    left.maxRasterHeight === right.maxRasterHeight &&
    leftTiff?.compression === rightTiff?.compression &&
    leftTiff?.pixelFormat === rightTiff?.pixelFormat;
}

function ValidationRow({ format, onHeight, onWidth }: { format: ViewerConfig["formats"][number]; onHeight: (height: number) => void; onWidth: (width: number) => void }) {
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

function RasterFields<T extends ViewerConfig["view"] | ViewerConfig["export"]>({ label, raster, onRaster }: { label: string; raster: T; onRaster: (raster: T) => void }) {
  return (
    <section className="raster-grid" aria-label={`${label} raster settings`}>
      <h3>{label}</h3>
      <RasterInput label={`${label} PDF DPI`} value={raster.pdfRasterDpi} onValue={(pdfRasterDpi) => onRaster({ ...raster, pdfRasterDpi })} />
      <RasterInput label={`${label} max pixels`} value={raster.maxRasterPixels} onValue={(maxRasterPixels) => onRaster({ ...raster, maxRasterPixels })} />
      <RasterInput label={`${label} max width`} value={raster.maxRasterWidth} onValue={(maxRasterWidth) => onRaster({ ...raster, maxRasterWidth })} />
      <RasterInput label={`${label} max height`} value={raster.maxRasterHeight} onValue={(maxRasterHeight) => onRaster({ ...raster, maxRasterHeight })} />
      {"tiff" in raster ? (
        <>
          <RasterInput label={`${label} TIFF compression`} value={raster.tiff.compression} onValue={(compression) => onRaster({ ...raster, tiff: { ...raster.tiff, compression } })} />
          <label className="validation-field">
            <span>{label} TIFF pixel format</span>
            <select value={raster.tiff.pixelFormat} onChange={(event) => onRaster({ ...raster, tiff: { ...raster.tiff, pixelFormat: event.currentTarget.value as ViewerConfig["export"]["tiff"]["pixelFormat"] } })}>
              <option value={TIFF_PIXEL_FORMAT_RGB24}>{TIFF_PIXEL_FORMAT_RGB24}</option>
              <option value={TIFF_PIXEL_FORMAT_GRAY8}>{TIFF_PIXEL_FORMAT_GRAY8}</option>
              <option value={TIFF_PIXEL_FORMAT_BW1}>{TIFF_PIXEL_FORMAT_BW1}</option>
            </select>
          </label>
        </>
      ) : null}
    </section>
  );
}

function RasterInput({ label, value, onValue }: { label: string; value: number; onValue: (value: number) => void }) {
  return (
    <label className="validation-field">
      <span>{label}</span>
      <input
        type="number"
        min="1"
        step="1"
        value={value}
        onChange={(event) => {
          if (Number.isFinite(event.currentTarget.valueAsNumber) && event.currentTarget.valueAsNumber > 0) {
            onValue(event.currentTarget.valueAsNumber);
          }
        }}
      />
    </label>
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
