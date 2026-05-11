import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DetailsPanel } from "./DetailsPanel";
import type { ViewerDetails } from "../lens/types";

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

describe("DetailsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders selected element counts", () => {
    render(<DetailsPanel details={details} error="" pageCount={1} status="ready" />);

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
    render(<DetailsPanel details={details} error="" pageCount={1} status="ready" />);

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
});
