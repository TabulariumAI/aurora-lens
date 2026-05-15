export const DEFAULT_PAGE_FORMATS = [
  { name: "letter", width: 8.5, height: 11 },
  { name: "legal", width: 8.5, height: 14 },
  { name: "a4", width: 8.27, height: 11.69 },
] as const;

export const DEFAULT_PAGE_TOLERANCE = 0.02;

export interface PageFormat {
  name: string;
  width: number;
  height: number;
}

export interface PageSizeInput {
  width: number;
  height: number;
  xResolution: number;
  yResolution: number;
}

export interface PageSizeConfig {
  formats: readonly PageFormat[];
  tolerance: number;
}

export type PageSizeResult =
  | {
    valid: true;
    documentType: string;
    xResolution: number;
    yResolution: number;
    physicalWidth: number;
    physicalHeight: number;
  }
  | {
    valid: false;
    reason: string;
  };

export function validateRasterPageSize(page: PageSizeInput, config: PageSizeConfig): PageSizeResult {
  if (page.xResolution > 0 && page.yResolution > 0) {
    const physicalWidth = page.width / page.xResolution;
    const physicalHeight = page.height / page.yResolution;
    const format = matchPageFormat(physicalWidth, physicalHeight, config);

    if (format) {
      return {
        valid: true,
        documentType: format.name,
        xResolution: page.xResolution,
        yResolution: page.yResolution,
        physicalWidth,
        physicalHeight,
      };
    }
  }

  const inferred = inferPageFormat(page.width, page.height, config);

  if (!inferred) {
    return {
      valid: false,
      reason: `Page size ${page.width}x${page.height} does not match configured formats`,
    };
  }

  return {
    valid: true,
    documentType: inferred.format.name,
    xResolution: inferred.xResolution,
    yResolution: inferred.yResolution,
    physicalWidth: inferred.physicalWidth,
    physicalHeight: inferred.physicalHeight,
  };
}

function matchPageFormat(physicalWidth: number, physicalHeight: number, config: PageSizeConfig) {
  for (const format of config.formats) {
    const candidates = [
      {
        width: format.width,
        height: format.height,
      },
      {
        width: format.height,
        height: format.width,
      },
    ];

    for (const candidate of candidates) {
      const widthOk = Math.abs(physicalWidth / candidate.width - 1) <= config.tolerance;
      const heightOk = Math.abs(physicalHeight / candidate.height - 1) <= config.tolerance;

      if (widthOk && heightOk) {
        return format;
      }
    }
  }

  return null;
}

function inferPageFormat(width: number, height: number, config: PageSizeConfig) {
  const imageRatio = Math.max(width, height) / Math.min(width, height);

  for (const format of config.formats) {
    const formatRatio = Math.max(format.width, format.height) / Math.min(format.width, format.height);
    const ratioOk = Math.abs(imageRatio / formatRatio - 1) <= config.tolerance;

    if (!ratioOk) {
      continue;
    }

    const portrait = height >= width;
    const physicalWidth = portrait ? format.width : format.height;
    const physicalHeight = portrait ? format.height : format.width;

    return {
      format,
      physicalWidth,
      physicalHeight,
      xResolution: width / physicalWidth,
      yResolution: height / physicalHeight,
    };
  }

  return null;
}
