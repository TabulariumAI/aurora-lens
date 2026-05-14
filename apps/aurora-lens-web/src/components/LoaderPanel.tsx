import type { RefObject } from "react";
import type { ViewerSample } from "../samples";

interface LoaderPanelProps {
  disabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  samples: ViewerSample[];
  onFiles: (files: FileList | File[]) => void;
  onSample: (sample: ViewerSample) => void;
}

export function LoaderPanel({ disabled, fileInputRef, samples, onFiles, onSample }: LoaderPanelProps) {
  return (
    <aside className="loader-panel" aria-label="Document loader">
      <div className="brand-block">
        <img className="brand-logo" src="/brand/tabularium-ai-lens-logo.png" alt="" aria-hidden="true" />
        <h1>Tabularium AI Lens</h1>
      </div>

      <label className="field">
        <span>Load document</span>
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".tif,.tiff,.pdf,.png,.jpg,.jpeg,image/tiff,application/pdf,image/png,image/jpeg"
          disabled={disabled}
          onChange={(event) => onFiles(event.currentTarget.files || [])}
        />
      </label>

      <DropTarget disabled={disabled} onFiles={onFiles} />

      <section className="sample-section" aria-label="Samples">
        <h2>Samples</h2>
        <div className="sample-list">
          {samples.map((sample) => (
            <button className="sample-button" type="button" key={sample.label} disabled={disabled} onClick={() => onSample(sample)}>
              {sample.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

interface DropTargetProps {
  disabled: boolean;
  onFiles: (files: FileList | File[]) => void;
}

function DropTarget({ disabled, onFiles }: DropTargetProps) {
  return (
    <div
      className={`drop-target${disabled ? " is-disabled" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        event.currentTarget.classList.add("is-active");
      }}
      onDragLeave={(event) => {
        event.currentTarget.classList.remove("is-active");
      }}
      onDrop={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        event.currentTarget.classList.remove("is-active");
        onFiles(event.dataTransfer.files || []);
      }}
    >
      Drop one document here
    </div>
  );
}
