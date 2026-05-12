import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DetailsPanel } from "./DetailsPanel";
import type { PageSizeConfig, ViewerDetails } from "../lens/types";

const details: ViewerDetails = {
  source: "sample.tiff",
  page: "1 of 1",
  size: "100 x 200",
  zoom: "100%",
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

const validationConfig: PageSizeConfig = {
  formats: [
    { name: "letter", width: 8.5, height: 11 },
    { name: "legal", width: 8.5, height: 14 },
    { name: "a4", width: 8.27, height: 11.69 },
  ],
  tolerance: 0.02,
};

describe("DetailsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders selected element counts", () => {
    render(<DetailsPanel allowEdit={true} details={details} error="" pageCount={1} status="ready" validationConfig={validationConfig} onAllowEdit={() => undefined} onValidationConfig={() => undefined} />);

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

  it("renders selection theme configuration", () => {
    render(<DetailsPanel allowEdit={true} details={details} error="" pageCount={1} status="ready" validationConfig={validationConfig} onAllowEdit={() => undefined} onValidationConfig={() => undefined} />);

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
    render(<DetailsPanel allowEdit={allowEdit} details={details} error="" pageCount={1} status="ready" validationConfig={validationConfig} onAllowEdit={(value) => {
      allowEdit = value;
    }} onValidationConfig={() => undefined} />);

    const toggle = screen.getByLabelText("Edit pages");
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    expect(allowEdit).toBe(false);
  });

  it("drafts page validation controls before save", () => {
    let config: PageSizeConfig = validationConfig;
    render(<DetailsPanel allowEdit={true} details={details} error="" pageCount={1} status="ready" validationConfig={config} onAllowEdit={() => undefined} onValidationConfig={(value) => {
      config = value;
    }} />);

    const panel = screen.getByLabelText("Page details");
    const validation = within(panel).getByLabelText("Page validation formats");
    expect(within(panel).getByRole("heading", { name: "Validation" })).toBeInTheDocument();
    expect(within(panel).getByLabelText("Tolerance")).toHaveValue(0.02);
    expect(within(validation).getByText("letter")).toBeInTheDocument();
    expect(within(validation).getByLabelText("letter width")).toHaveValue(8.5);
    expect(within(validation).getByLabelText("letter height")).toHaveValue(11);
    expect(within(panel).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.change(within(validation).getByLabelText("letter width"), {
      target: {
        value: "8.25",
      },
    });

    expect(config).toBe(validationConfig);
    expect(within(panel).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "Cancel" })).toBeEnabled();

    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));

    expect(config).toEqual({
      formats: [
        { name: "letter", width: 8.25, height: 11 },
        { name: "legal", width: 8.5, height: 14 },
        { name: "a4", width: 8.27, height: 11.69 },
      ],
      tolerance: 0.02,
    });
  });

  it("cancels drafted page validation changes", () => {
    let config: PageSizeConfig = validationConfig;
    render(<DetailsPanel allowEdit={true} details={details} error="" pageCount={1} status="ready" validationConfig={config} onAllowEdit={() => undefined} onValidationConfig={(value) => {
      config = value;
    }} />);

    fireEvent.change(screen.getByLabelText("letter width"), {
      target: {
        value: "8.25",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(config).toBe(validationConfig);
    expect(screen.getByLabelText("letter width")).toHaveValue(8.5);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
