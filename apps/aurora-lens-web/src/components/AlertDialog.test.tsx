import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlertDialog } from "./AlertDialog";

describe("AlertDialog", () => {
  it("renders alert dialog semantics and confirms with OK", () => {
    const onOk = vi.fn();

    render(<AlertDialog title="Document Error" message="Choose a supported document." onOk={onOk} />);

    const dialog = screen.getByRole("alertdialog", { name: "Document Error" });
    expect(dialog).toHaveClass("alert-overlay");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "Document Error" }).parentElement).toHaveClass("alert-dialog");
    expect(within(dialog).getByText("Choose a supported document.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    expect(onOk).toHaveBeenCalledTimes(1);
  });
});
