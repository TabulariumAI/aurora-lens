export interface AuroraTiffModule {
  HEAPU8: Uint8Array;
  _free(pointer: number): void;
  _malloc(size: number): number;
  _TiffCountDirectories(handle: number): number;
  _TiffCreate(pointer: number, size: number): number;
  _TiffDestroy(handle: number): void;
  _TiffGetHeight(handle: number): number;
  _TiffGetResolutionUnit(handle: number): number;
  _TiffGetWidth(handle: number): number;
  _TiffGetXResolution(handle: number): number;
  _TiffGetYResolution(handle: number): number;
  _TiffReadRGBA(handle: number, pointer: number, size: number): number;
  _TiffSetDirectory(handle: number, index: number): number;
  _TiffWriterAddRGBA(writer: number, pointer: number, width: number, height: number, compression: number, pixelFormat: number, resolutionUnit: number, xResolution: number, yResolution: number): number;
  _TiffWriterCreate(compression: number): number;
  _TiffWriterDestroy(writer: number): void;
  _TiffWriterFinish(writer: number, sizePointer: number): number;
  _TiffFreeMemory(pointer: number): void;
}

export default function createAuroraTiffModule(moduleArg?: object): Promise<AuroraTiffModule>;
