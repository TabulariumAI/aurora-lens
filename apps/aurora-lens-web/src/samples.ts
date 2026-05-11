export interface ViewerSample {
  label: string;
  metadataUrl: string;
  tiffName: string;
  tiffUrl: string;
}

export const VIEWER_SAMPLES: ViewerSample[] = [
  {
    label: "sample-1",
    metadataUrl: "/samples/sample-1/sample.json",
    tiffName: "sample.tiff",
    tiffUrl: "/samples/sample-1/sample.tiff",
  },
  {
    label: "sample-2",
    metadataUrl: "/samples/sample-2/sample.json",
    tiffName: "sample.tiff",
    tiffUrl: "/samples/sample-2/sample.tiff",
  },
  {
    label: "sample-3",
    metadataUrl: "/samples/sample-3/sample.json",
    tiffName: "sample.tiff",
    tiffUrl: "/samples/sample-3/sample.tiff",
  },
];
