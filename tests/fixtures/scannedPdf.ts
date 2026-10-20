export function scannedPdf(filter: "JBIG2Decode" | "CCITTFaxDecode"): Uint8Array {
  // Group 4 test bitmap, embedded directly or in a JBIG2 generic region.
  const bits = "00100110101000101" + "1111111" + "000000000001000000000001";
  const mmr = Array.from({ length: Math.ceil(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).padEnd(8, "0"), 2));
  const u32 = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const segment = (id: number, type: number, data: number[]) => [...u32(id), type, 0, 1, ...u32(data.length), ...data];
  const image = filter === "JBIG2Decode" ? [
    ...segment(1, 48, [...u32(8), ...u32(8), ...u32(0), ...u32(0), 0, 0, 0]),
    ...segment(2, 38, [...u32(8), ...u32(8), ...u32(0), ...u32(0), 0, 1, ...mmr]),
    ...segment(3, 49, []),
  ] : mmr;
  const hex = image.map(b => b.toString(16).padStart(2, "0")).join("") + ">";
  const content = "q 144 0 0 144 72 576 cm /Im0 Do Q";
  const page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 7 0 R >> >> /Contents 6 0 R >>";
  const params = filter === "CCITTFaxDecode" ? "<< /K -1 /Columns 8 /Rows 8 /BlackIs1 true >>" : "null";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    page, page, page,
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter [/ASCIIHexDecode /" + filter + "] /DecodeParms [null " + params + "] /Length " + hex.length + " >>\nstream\n" + hex + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
    return offset;
  });
  const xref = pdf.length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n" + offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return new TextEncoder().encode(pdf);
}
