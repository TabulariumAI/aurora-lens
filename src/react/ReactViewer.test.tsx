const pageSize = { formats: [{ name: "scan", width: 1, height: 2 }], tolerance: 0.02 };
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AuroraLens } from "../core/AuroraLens";
import { ReactViewer } from "./ReactViewer";

const instances = vi.hoisted(() => [] as Array<{ close: ReturnType<typeof vi.fn>; setAllowEdit: ReturnType<typeof vi.fn> }>);
const constructor = vi.hoisted(() => vi.fn(function () {
  const lens = { close: vi.fn(), setAllowEdit: vi.fn() };
  instances.push(lens);
  return lens;
}));
vi.mock("../core/AuroraLens", () => ({ AuroraLens: constructor }));

it("passes session ownership and replaces the viewer and ref when it changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const ref = createRef<AuroraLens>();
  try {
    await act(async () => root.render(createElement(ReactViewer, { ref, pageSize, allowEdit: false, sessionId: "A" })));
    expect(constructor).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ sessionId: "A", pageSize }));
    expect(ref.current).toBe(instances[0]);
    await act(async () => root.render(createElement(ReactViewer, { ref, pageSize, allowEdit: false, sessionId: "B" })));
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ sessionId: "B", pageSize }));
    expect(ref.current).toBe(instances[1]);
    const updated = { ...pageSize, tolerance: 0.04 };
    await act(async () => root.render(createElement(ReactViewer, { ref, pageSize: updated, allowEdit: false, sessionId: "B" })));
    expect(instances[1].close).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ sessionId: "B", pageSize: updated }));
    expect(ref.current).toBe(instances[2]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
