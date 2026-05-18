export const viewerWatermarkText = "Powered by Tabularium AI";

export const viewerWatermarkStyle = {
  position: "absolute",
  left: "50%",
  bottom: "0.625rem",
  zIndex: "2",
  maxWidth: "calc(100% - 1.5rem)",
  padding: "0.125rem 0.375rem",
  borderRadius: "0.25rem",
  color: "rgba(31, 41, 55, 0.62)",
  background: "rgba(255, 255, 255, 0.58)",
  fontSize: "0.875rem",
  fontWeight: "700",
  lineHeight: "1.2",
  pointerEvents: "none",
  textAlign: "center",
  textShadow: "0 1px 1px rgba(255, 255, 255, 0.72)",
  transform: "translateX(-50%)",
  userSelect: "none",
  whiteSpace: "nowrap",
};

export function createViewerWatermark() {
  const watermark = document.createElement("span");
  watermark.textContent = viewerWatermarkText;
  watermark.setAttribute("aria-hidden", "true");
  Object.assign(watermark.style, viewerWatermarkStyle);
  return watermark;
}
