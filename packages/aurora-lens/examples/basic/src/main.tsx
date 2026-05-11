import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuroraLensView } from "@tabularium/aurora-lens/react";
import type { AuroraLens, AuroraLensState } from "@tabularium/aurora-lens";
import { MockDecoder } from "./mockDecoder";
import "./styles.css";

const metadata = {
  pages: [
    {
      tokens: [
        { token: "Aurora", confidence: "HIGH", polygon: [96, 104, 360, 104, 360, 176, 96, 176] },
        { token: "Lens", confidence: "HIGH", polygon: [392, 104, 650, 104, 650, 176, 392, 176] },
      ],
      contexts: [
        { role: "title", content: "Aurora Lens Example", polygon: [88, 88, 700, 88, 700, 196, 88, 196] },
      ],
      figures: [{ polygon: [96, 640, 336, 640, 336, 780, 96, 780] }],
    },
    {
      tokens: [],
      contexts: [],
      figures: [],
    },
  ],
};

function Example() {
  const lensRef = useRef<AuroraLens | null>(null);
  const decoder = useMemo(() => new MockDecoder(), []);
  const [state, setState] = useState<AuroraLensState | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const file = new File(["example"], "example.raster", { type: "application/octet-stream" });
    setError("");
    await lensRef.current?.loadMetadata(metadata);
    await lensRef.current?.decodeTiff(file, 0);
  };

  return (
    <main className="example-shell">
      <header className="example-toolbar">
        <h1>Aurora Lens</h1>
        <button type="button" onClick={() => void load().catch((reason) => setError(String(reason)))}>
          Load example
        </button>
        <button type="button" disabled={!state?.canSearch} onClick={() => void lensRef.current?.search("Aurora")}>
          Search Aurora
        </button>
        <button type="button" disabled={!state?.canShowThumbnails} onClick={() => void lensRef.current?.showThumbnails()}>
          Thumbnails
        </button>
      </header>
      <section className="example-viewer" aria-label="Aurora Lens example viewer">
        <AuroraLensView
          ref={lensRef}
          decoder={decoder}
          onError={(reason) => setError(reason.message)}
          onStateChange={setState}
        />
      </section>
      <footer className="example-status" aria-live="polite">
        {error || (state?.sourceName ? `${state.sourceName}: page ${state.pageIndex + 1} of ${state.pageCount}` : "No page loaded")}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Example />
  </StrictMode>
);
