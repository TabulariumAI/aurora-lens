import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoaderPanel } from "./LoaderPanel";

describe("LoaderPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders upload controls and forwards dropped files", () => {
    const onFiles = vi.fn();
    render(
      <LoaderPanel
        disabled={false}
        fileInputRef={createRef<HTMLInputElement>()}
        samples={[
          {
            label: "sample-1",
            metadataUrl: "/samples/sample-1/sample.json",
            tiffName: "sample.tiff",
            tiffUrl: "/samples/sample-1/sample.tiff",
          },
        ]}
        onFiles={onFiles}
        onSample={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Tabularium AI Lens" })).toBeInTheDocument();
    expect(screen.getByLabelText("Load document")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Samples (Intelligence ready)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sample-1" })).toBeInTheDocument();

    const file = new File(["sample"], "sample.tiff", { type: "image/tiff" });
    fireEvent.drop(screen.getByRole("button", { name: "Drop one document here" }), {
      dataTransfer: {
        files: [file],
      },
    });

    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("forwards selected samples", () => {
    const sample = {
      label: "sample-1",
      metadataUrl: "/samples/sample-1/sample.json",
      tiffName: "sample.tiff",
      tiffUrl: "/samples/sample-1/sample.tiff",
    };
    const onSample = vi.fn();
    render(
      <LoaderPanel
        disabled={false}
        fileInputRef={createRef<HTMLInputElement>()}
        samples={[sample]}
        onFiles={vi.fn()}
        onSample={onSample}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "sample-1" }));

    expect(onSample).toHaveBeenCalledWith(sample);
  });
});
