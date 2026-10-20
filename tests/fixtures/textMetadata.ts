export function textMetadata(...paragraphs: string[]) {
  return {
    pages: [{
      pageNumber: 1,
      width: 10000,
      height: paragraphs.length * 40,
      tokens: paragraphs.flatMap((text, row) => text.split(/\s+/).filter(Boolean).map((content, column) => ({
        content,
        confidence: 0.99,
        polygon: [column * 20 + 1, row * 40 + 1, column * 20 + 19, row * 40 + 1, column * 20 + 19, row * 40 + 19, column * 20 + 1, row * 40 + 19],
      }))),
      contexts: paragraphs.map((content, row) => ({
        content,
        role: "body",
        polygon: [0, row * 40, 10000, row * 40, 10000, row * 40 + 30, 0, row * 40 + 30],
      })),
      figures: [],
    }],
  };
}
