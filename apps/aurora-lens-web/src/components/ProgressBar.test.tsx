import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders provided loading text and progressbar semantics", () => {
    render(<ProgressBar text="Decoding TIFF pages..." />);

    expect(screen.getByRole("status")).toHaveTextContent("Decoding TIFF pages...");
    expect(screen.getByRole("progressbar", { name: "Decoding TIFF pages..." })).toBeInTheDocument();
  });
});
