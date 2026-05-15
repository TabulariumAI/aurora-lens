import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsPanel } from "./DetailsPanel";
import type { ViewerConfig, ViewerDetails } from "../lens/types";

vi.mock("@tabularium/aurora-lens", () => ({
  TIFF_PIXEL_FORMAT_BW1: "bw1",
  TIFF_PIXEL_FORMAT_GRAY8: "gray8",
  TIFF_PIXEL_FORMAT_RGB24: "rgb24",
}));

const details: ViewerDetails = {
  source: "sample.tiff",
  page: "1 of 1",
  size: "100 x 200",
  zoom: "100%",
  info: {
    pageNumber: 1,
    class: "assumed name abandonment",
    segments: ["Exhibit", "Recital"],
    indexes: [
      {
        label: "Recording Number",
        value: "20250631357",
        source: "Document Number: 20250631357",
        ambiguous: "NO",
      },
    ],
  },
  tokens: "3",
  figures: "2",
  context: "5",
  theme: {
    context: {
      fill: "rgba(255, 230, 128, 0.25)",
      stroke: "rgba(183, 121, 31, 0.72)",
    },
    figure: {
      fill: "rgba(0, 0, 128, 0.12)",
      stroke: "navy",
    },
    tokenHigh: {
      fill: "rgba(0, 81, 104, 0.12)",
      stroke: "#005168",
    },
    tokenMedium: {
      fill: "rgba(183, 121, 31, 0.16)",
      stroke: "#B7791F",
    },
    tokenLow: {
      fill: "rgba(180, 35, 24, 0.12)",
      stroke: "#B42318",
    },
    confidence: {
      high: ">=95%",
      medium: ">=80%",
      low: "<80%",
    },
  },
};

const viewerConfig: ViewerConfig = {
  formats: [
    { name: "letter", width: 8.5, height: 11 },
    { name: "legal", width: 8.5, height: 14 },
    { name: "a4", width: 8.27, height: 11.69 },
  ],
  tolerance: 0.02,
  view: {
    pdfRasterDpi: 150,
    maxRasterPixels: 40_000_000,
    maxRasterWidth: 10_000,
    maxRasterHeight: 10_000,
  },
  export: {
    pdfRasterDpi: 300,
    maxRasterPixels: 160_000_000,
    maxRasterWidth: 20_000,
    maxRasterHeight: 20_000,
    tiff: {
      compression: 5,
      pixelFormat: "rgb24",
    },
  },
};

function defaultViewerConfig(): ViewerConfig {
  return {
    formats: viewerConfig.formats.map((format) => ({ ...format })),
    tolerance: viewerConfig.tolerance,
    view: { ...viewerConfig.view },
    export: {
      ...viewerConfig.export,
      tiff: { ...viewerConfig.export.tiff },
    },
  };
}

function renderDetails(config = viewerConfig, onViewerConfig: (value: ViewerConfig) => void = () => undefined) {
  return render(<DetailsPanel allowEdit={true} canExport={true} defaultConfig={defaultViewerConfig()} details={details} error="" exporting={false} pageCount={1} status="ready" viewerConfig={config} onAllowEdit={() => undefined} onExport={() => undefined} onViewerConfig={onViewerConfig} />);
}

describe("DetailsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders selected element counts", () => {
    renderDetails();

    const panel = screen.getByLabelText("Page details");
    const selection = within(panel).getByLabelText("Selection");
    expect(within(selection).getByText("Tokens")).toBeInTheDocument();
    expect(within(selection).getByText("Figures")).toBeInTheDocument();
    expect(within(selection).getByText("Context")).toBeInTheDocument();
    expect(within(selection).getByText("3")).toBeInTheDocument();
    expect(within(selection).getByText("2")).toBeInTheDocument();
    expect(within(selection).getByText("5")).toBeInTheDocument();
    expect(within(panel).queryByText("Rectangles")).not.toBeInTheDocument();
  });

  it("renders the right panel in document and page groups", () => {
    renderDetails();

    const panel = screen.getByLabelText("Page details");
    const document = within(panel).getByRole("region", { name: "Document" });
    const page = within(panel).getByRole("region", { name: "Page" });
    expect(within(document).getByText("Source")).toBeInTheDocument();
    expect(within(document).getByText("sample.tiff")).toBeInTheDocument();
    expect(within(document).queryByText("Size")).not.toBeInTheDocument();
    expect(within(document).getByRole("button", { name: "Download TIFF" })).toBeInTheDocument();
    expect(within(document).getByRole("button", { name: "Image Settings" })).toBeInTheDocument();
    expect(within(page).getByLabelText("Edit pages")).toBeInTheDocument();
    const pageMetadata = within(page).getAllByRole("definition").map((element) => element.textContent);
    expect(pageMetadata).toEqual(expect.arrayContaining(["1 of 1", "100 x 200", "100%", "1", "assumed name abandonment", "Exhibit, Recital"]));
    expect(within(page).getByRole("region", { name: "Page Info" })).toBeInTheDocument();
    expect(within(page).queryByText("Recording Number: 20250631357")).not.toBeInTheDocument();
    expect(within(page).getByRole("region", { name: "Selection" })).toBeInTheDocument();
    expect(within(page).getByRole("region", { name: "Style" })).toBeInTheDocument();
    expect(document.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders selection theme configuration", () => {
    renderDetails();

    const panel = screen.getByLabelText("Page details");
    expect(within(panel).getByRole("heading", { name: "Style" })).toBeInTheDocument();
    const table = within(panel).getByRole("table", { name: "Selection style" });
    expect(within(table).getByText("Fill")).toBeInTheDocument();
    expect(within(table).getByText("Border")).toBeInTheDocument();
    expect(within(table).getByText("Context")).toBeInTheDocument();
    expect(within(table).getByText("Figure")).toBeInTheDocument();
    expect(within(table).getByText("High >=95%")).toBeInTheDocument();
    expect(within(table).getByText("Medium >=80%")).toBeInTheDocument();
    expect(within(table).getByText("Low <80%")).toBeInTheDocument();
    expect(within(table).getByLabelText("Context fill rgba(255, 230, 128, 0.25)")).toBeInTheDocument();
    expect(within(table).getByLabelText("Context border rgba(183, 121, 31, 0.72)")).toBeInTheDocument();
    expect(within(table).getByLabelText("Figure fill rgba(0, 0, 128, 0.12)")).toBeInTheDocument();
    expect(within(table).getByLabelText("Figure border navy")).toBeInTheDocument();
    expect(within(table).getByLabelText("High >=95% fill rgba(0, 81, 104, 0.12)")).toBeInTheDocument();
    expect(within(table).getByLabelText("High >=95% border #005168")).toBeInTheDocument();
    expect(within(table).queryByText(/rgba/)).not.toBeInTheDocument();
  });

  it("renders the edit toggle", () => {
    let allowEdit = true;
    render(<DetailsPanel allowEdit={allowEdit} canExport={true} defaultConfig={defaultViewerConfig()} details={details} error="" exporting={false} pageCount={1} status="ready" viewerConfig={viewerConfig} onAllowEdit={(value) => {
      allowEdit = value;
    }} onExport={() => undefined} onViewerConfig={() => undefined} />);

    const toggle = screen.getByLabelText("Edit pages");
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    expect(allowEdit).toBe(false);
  });

  it("drafts page validation controls before save", () => {
    let config: ViewerConfig = viewerConfig;
    renderDetails(config, (value) => {
      config = value;
    });

    const panel = screen.getByLabelText("Page details");
    expect(within(panel).getByRole("button", { name: "Image Settings" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Image Settings" }));

    const dialog = screen.getByRole("dialog", { name: "Image Settings" });
    const validation = within(dialog).getByRole("table", { name: "Page validation formats" });
    expect(within(dialog).getByLabelText("Tolerance")).toHaveValue(0.02);
    expect(within(validation).getByText("letter")).toBeInTheDocument();
    expect(within(validation).getByLabelText("letter width")).toHaveValue(8.5);
    expect(within(validation).getByLabelText("letter height")).toHaveValue(11);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.change(within(validation).getByLabelText("letter width"), {
      target: {
        value: "8.25",
      },
    });

    expect(config).toBe(viewerConfig);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(config).toEqual({
      formats: [
        { name: "letter", width: 8.25, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
      view: viewerConfig.view,
      export: viewerConfig.export,
    });
  });

  it("drafts view and export raster controls before save", () => {
    let config: ViewerConfig = viewerConfig;
    renderDetails(config, (value) => {
      config = value;
    });

    const panel = screen.getByLabelText("Page details");
    expect(within(panel).queryByLabelText("View PDF DPI")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Image Settings" }));

    const dialog = screen.getByRole("dialog", { name: "Image Settings" });
    expect(within(dialog).getByLabelText("View PDF DPI")).toHaveValue(150);
    expect(within(dialog).getByLabelText("View max pixels")).toHaveValue(40_000_000);
    expect(within(dialog).getByLabelText("View max width")).toHaveValue(10_000);
    expect(within(dialog).getByLabelText("View max height")).toHaveValue(10_000);
    expect(within(dialog).getByLabelText("Export PDF DPI")).toHaveValue(300);
    expect(within(dialog).getByLabelText("Export max pixels")).toHaveValue(160_000_000);
    expect(within(dialog).getByLabelText("Export max width")).toHaveValue(20_000);
    expect(within(dialog).getByLabelText("Export max height")).toHaveValue(20_000);
    expect(within(dialog).getByLabelText("Export TIFF compression")).toHaveValue(5);
    expect(within(dialog).getByLabelText("Export TIFF pixel format")).toHaveValue("rgb24");

    fireEvent.change(within(dialog).getByLabelText("View PDF DPI"), {
      target: {
        value: "125",
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(config).toEqual({
      ...viewerConfig,
      view: {
        ...viewerConfig.view,
        pdfRasterDpi: 125,
      },
    });
  });

  it("resets drafted viewer config to package defaults before save", () => {
    let config: ViewerConfig = {
      formats: [
        { name: "custom", width: 4, height: 6 },
      ],
      tolerance: 0.5,
      view: {
        pdfRasterDpi: 75,
        maxRasterPixels: 20_000_000,
        maxRasterWidth: 5_000,
        maxRasterHeight: 5_000,
      },
      export: {
        pdfRasterDpi: 200,
        maxRasterPixels: 80_000_000,
        maxRasterWidth: 12_000,
        maxRasterHeight: 12_000,
        tiff: {
          compression: 4,
          pixelFormat: "gray8",
        },
      },
    };
    renderDetails(config, (value) => {
      config = value;
    });

    fireEvent.click(screen.getByRole("button", { name: "Image Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Image Settings" });
    expect(within(dialog).getByLabelText("Tolerance")).toHaveValue(0.5);
    expect(within(dialog).getByLabelText("View PDF DPI")).toHaveValue(75);

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect(config.tolerance).toBe(0.5);
    expect(within(dialog).getByLabelText("Tolerance")).toHaveValue(0.02);
    expect(within(dialog).getByLabelText("letter width")).toHaveValue(8.5);
    expect(within(dialog).getByLabelText("View PDF DPI")).toHaveValue(150);
    expect(within(dialog).getByLabelText("Export TIFF compression")).toHaveValue(5);
    expect(within(dialog).getByLabelText("Export TIFF pixel format")).toHaveValue("rgb24");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(config).toEqual(defaultViewerConfig());
  });

  it("cancels drafted page validation changes", () => {
    let config: ViewerConfig = viewerConfig;
    renderDetails(config, (value) => {
      config = value;
    });

    fireEvent.click(screen.getByRole("button", { name: "Image Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Image Settings" });
    fireEvent.change(within(dialog).getByLabelText("letter width"), {
      target: {
        value: "8.25",
      },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(config).toBe(viewerConfig);
    expect(within(dialog).getByLabelText("letter width")).toHaveValue(8.5);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("calls export from the right panel", () => {
    let exported = false;
    render(<DetailsPanel allowEdit={true} canExport={true} defaultConfig={defaultViewerConfig()} details={details} error="" exporting={false} pageCount={1} status="ready" viewerConfig={viewerConfig} onAllowEdit={() => undefined} onExport={() => {
      exported = true;
    }} onViewerConfig={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Download TIFF" }));

    expect(exported).toBe(true);
  });

  it("disables TIFF export while exporting", () => {
    render(<DetailsPanel allowEdit={true} canExport={true} defaultConfig={defaultViewerConfig()} details={details} error="" exporting={true} pageCount={1} status="ready" viewerConfig={viewerConfig} onAllowEdit={() => undefined} onExport={() => undefined} onViewerConfig={() => undefined} />);

    const button = screen.getByRole("button", { name: "Exporting TIFF" });
    expect(button).toBeDisabled();
    expect(button.querySelector(".export-spinner")).not.toBeNull();
  });
});
