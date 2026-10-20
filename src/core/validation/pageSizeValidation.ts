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
    requiredTolerance: number;
  };

export function validateRasterPageSize(page: PageSizeInput, config: PageSizeConfig): PageSizeResult {
  const candidates = config.formats.flatMap(format => {
    if (page.xResolution <= 0 || page.yResolution <= 0) return [];
    const physicalWidth = page.width / page.xResolution;
    const physicalHeight = page.height / page.yResolution;
    return [format, { width: format.height, height: format.width }].map(size => ({
      documentType: format.name,
      xResolution: page.xResolution,
      yResolution: page.yResolution,
      physicalWidth,
      physicalHeight,
      tolerance: Math.max(Math.abs(physicalWidth / size.width - 1), Math.abs(physicalHeight / size.height - 1)),
    }));
  });
  const imageRatio = Math.max(page.width, page.height) / Math.min(page.width, page.height);
  for (const format of config.formats) {
    const portrait = page.height >= page.width;
    const physicalWidth = portrait ? format.width : format.height;
    const physicalHeight = portrait ? format.height : format.width;
    const formatRatio = Math.max(format.width, format.height) / Math.min(format.width, format.height);
    candidates.push({
      documentType: format.name,
      xResolution: page.width / physicalWidth,
      yResolution: page.height / physicalHeight,
      physicalWidth,
      physicalHeight,
      tolerance: Math.abs(imageRatio / formatRatio - 1),
    });
  }
  const match = candidates.find(candidate => candidate.tolerance <= config.tolerance);
  if (!match) {
    return {
      valid: false,
      reason: `Page size ${page.width}x${page.height} does not match configured formats`,
      requiredTolerance: Math.min(...candidates.map(candidate => candidate.tolerance)),
    };
  }
  return {
    valid: true,
    documentType: match.documentType,
    xResolution: match.xResolution,
    yResolution: match.yResolution,
    physicalWidth: match.physicalWidth,
    physicalHeight: match.physicalHeight,
  };
}
