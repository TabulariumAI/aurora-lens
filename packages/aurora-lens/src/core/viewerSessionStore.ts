export const VIEWER_SESSION_DB_NAME = "aurora-lens-web";
import type { DocType } from "./documentDecoder/types";
import {
  TIFF_PIXEL_FORMAT_BW1,
  TIFF_PIXEL_FORMAT_GRAY8,
  TIFF_PIXEL_FORMAT_RGB24,
  defaultViewerConfig,
  type ExportConfig,
  type RasterConfig,
  type TiffPixelFormat,
  type ViewerConfig,
} from "./viewerConfig";

export const VIEWER_SESSION_DB_VERSION = 4;
export const VIEWER_DOCUMENT_STORE_NAME = "viewer-documents";
export const VIEWER_PAGE_STORE_NAME = "viewer-pages";
export const VIEWER_PAGE_BLOB_STORE_NAME = "viewer-page-blobs";
export const VIEWER_PAGE_METADATA_STORE_NAME = "viewer-page-metadata";
export const VIEWER_CONFIG_STORE_NAME = "viewer-config";
export const ACTIVE_VIEWER_SESSION_ID = "active";
const VIEWER_CONFIG_ID = "viewer-config";

export interface ViewerDocumentRecord {
  id: typeof ACTIVE_VIEWER_SESSION_ID;
  fileName: string;
  fileType: string;
  fileBlob: Blob;
  // pageId is the system-assigned unique page GUID, not the page number.
  currentPageId: string;
  updatedAt: number;
}

export interface ViewerPageRecord {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  documentId: typeof ACTIVE_VIEWER_SESSION_ID;
  sequenceNumber: number;
  sourcePageIndex: number;
  updatedAt: number;
}

export interface ViewerPageBlobRecord {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  blob: Blob;
  sourceType: DocType;
  width: number;
  height: number;
  xResolution: number;
  yResolution: number;
  documentType: string;
  physicalWidth: number;
  physicalHeight: number;
  updatedAt: number;
}

export interface ViewerPageMetadataRecord {
  // pageId is the system-assigned unique page GUID, not the page number.
  pageId: string;
  metadata: unknown;
  updatedAt: number;
}

export interface ViewerDocumentInput {
  fileName: string;
  fileType: string;
  fileBlob: Blob;
  pages: ViewerPageRecord[];
  pageCount: number;
  currentPageIndex: number;
  updatedAt: number;
}

export interface ViewerSession {
  document: ViewerDocumentRecord;
  pages: ViewerPageRecord[];
  currentPage: ViewerPageRecord;
}

export interface ViewerSessionStore {
  resetDocument(input: ViewerDocumentInput): Promise<ViewerPageRecord[]>;
  insertPages(insertIndex: number, pages: ViewerPageRecord[], blobs: ViewerPageBlobRecord[], updatedAt: number): Promise<ViewerPageRecord[]>;
  removePages(pageIds: string[], updatedAt: number): Promise<ViewerPageRecord[]>;
  readViewerConfig(): Promise<ViewerConfig>;
  saveCurrentPage(pageId: string, updatedAt: number): Promise<void>;
  savePageBlob(record: ViewerPageBlobRecord): Promise<void>;
  savePageMetadata(record: ViewerPageMetadataRecord): Promise<void>;
  saveViewerConfig(config: ViewerConfig): Promise<ViewerConfig>;
  reorderPages(fromPageIndex: number, toPageIndex: number, updatedAt: number): Promise<ViewerPageRecord[]>;
  read(): Promise<ViewerSession | null>;
  readPageBlobRecord(pageId: string): Promise<ViewerPageBlobRecord | null>;
  readPageMetadata(pageId: string): Promise<unknown | null>;
  readPageMetadataIds(): Promise<Set<string>>;
  delete(): Promise<void>;
}

export class IndexedDbViewerSessionStore implements ViewerSessionStore {
  async resetDocument(input: ViewerDocumentInput): Promise<ViewerPageRecord[]> {
    const pages = validatePages(input.pages);
    const currentPage = pages[input.currentPageIndex];
    const database = await this.open();
    try {
      const transaction = database.transaction(allStores, "readwrite");
      allStores.forEach((storeName) => {
        transaction.objectStore(storeName).clear();
      });
      await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).put({
        id: ACTIVE_VIEWER_SESSION_ID,
        fileName: input.fileName,
        fileType: input.fileType,
        fileBlob: input.fileBlob,
        currentPageId: currentPage.pageId,
        updatedAt: input.updatedAt,
      }));
      pages.forEach((page) => {
        transaction.objectStore(VIEWER_PAGE_STORE_NAME).put(page);
      });
      await transactionDone(transaction);
      return pages;
    } finally {
      database.close();
    }
  }

  async insertPages(insertIndex: number, inputPages: ViewerPageRecord[], blobs: ViewerPageBlobRecord[], updatedAt: number): Promise<ViewerPageRecord[]> {
    const newPages = validatePages(inputPages);
    const newBlobs = blobs.map(validatePageBlob);
    const database = await this.open();
    try {
      const transaction = database.transaction([VIEWER_DOCUMENT_STORE_NAME, VIEWER_PAGE_STORE_NAME, VIEWER_PAGE_BLOB_STORE_NAME], "readwrite");
      const document = validateDocument(await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).get(ACTIVE_VIEWER_SESSION_ID)));
      const pageStore = transaction.objectStore(VIEWER_PAGE_STORE_NAME);
      const pages = validatePages(await requestToPromise(pageStore.getAll()));
      if (insertIndex < 0 || insertIndex > pages.length || newPages.some((page) => page.documentId !== document.id)) {
        throw invalidSessionError();
      }
      const orderedPages = insertPageRecords(pages, insertIndex, newPages, updatedAt);
      orderedPages.forEach((page) => {
        pageStore.put(page);
      });
      newBlobs.forEach((blob) => {
        transaction.objectStore(VIEWER_PAGE_BLOB_STORE_NAME).put(blob);
      });
      await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).put({
        ...document,
        updatedAt,
      }));
      await transactionDone(transaction);
      return orderedPages;
    } finally {
      database.close();
    }
  }

  async removePages(pageIds: string[], updatedAt: number): Promise<ViewerPageRecord[]> {
    const database = await this.open();
    try {
      const transaction = database.transaction([VIEWER_DOCUMENT_STORE_NAME, VIEWER_PAGE_STORE_NAME, VIEWER_PAGE_BLOB_STORE_NAME, VIEWER_PAGE_METADATA_STORE_NAME], "readwrite");
      const document = validateDocument(await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).get(ACTIVE_VIEWER_SESSION_ID)));
      const pageStore = transaction.objectStore(VIEWER_PAGE_STORE_NAME);
      const pages = validatePages(await requestToPromise(pageStore.getAll()));
      const pageIdSet = new Set(pageIds);
      const orderedPages = removePageRecords(pages, pageIdSet, updatedAt);
      if (!orderedPages.some((page) => page.pageId === document.currentPageId)) {
        throw invalidSessionError();
      }
      pageIdSet.forEach((pageId) => {
        pageStore.delete(pageId);
        transaction.objectStore(VIEWER_PAGE_BLOB_STORE_NAME).delete(pageId);
        transaction.objectStore(VIEWER_PAGE_METADATA_STORE_NAME).delete(pageId);
      });
      orderedPages.forEach((page) => {
        pageStore.put(page);
      });
      await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).put({
        ...document,
        updatedAt,
      }));
      await transactionDone(transaction);
      return orderedPages;
    } finally {
      database.close();
    }
  }

  async saveCurrentPage(pageId: string, updatedAt: number): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_DOCUMENT_STORE_NAME, "readwrite");
      const document = validateDocument(await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).get(ACTIVE_VIEWER_SESSION_ID)));
      await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).put({
        ...document,
        currentPageId: pageId,
        updatedAt,
      }));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async readViewerConfig(): Promise<ViewerConfig> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_CONFIG_STORE_NAME, "readonly");
      const value = await requestToPromise(transaction.objectStore(VIEWER_CONFIG_STORE_NAME).get(VIEWER_CONFIG_ID));
      await transactionDone(transaction);
      return value === undefined ? defaultViewerConfig() : validateViewerConfig(value);
    } finally {
      database.close();
    }
  }

  async savePageBlob(record: ViewerPageBlobRecord): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_PAGE_BLOB_STORE_NAME, "readwrite");
      await requestToPromise(transaction.objectStore(VIEWER_PAGE_BLOB_STORE_NAME).put(record));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async savePageMetadata(record: ViewerPageMetadataRecord): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_PAGE_METADATA_STORE_NAME, "readwrite");
      await requestToPromise(transaction.objectStore(VIEWER_PAGE_METADATA_STORE_NAME).put(record));
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async saveViewerConfig(config: ViewerConfig): Promise<ViewerConfig> {
    const value = validateViewerConfig({
      id: VIEWER_CONFIG_ID,
      formats: config.formats,
      tolerance: config.tolerance,
      view: config.view,
      export: config.export,
    });
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_CONFIG_STORE_NAME, "readwrite");
      await requestToPromise(transaction.objectStore(VIEWER_CONFIG_STORE_NAME).put({
        id: VIEWER_CONFIG_ID,
        ...value,
      }));
      await transactionDone(transaction);
      return value;
    } finally {
      database.close();
    }
  }

  async reorderPages(fromPageIndex: number, toPageIndex: number, updatedAt: number): Promise<ViewerPageRecord[]> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_PAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(VIEWER_PAGE_STORE_NAME);
      const pages = validatePages(await requestToPromise(store.getAll()));
      if (
        fromPageIndex < 0 ||
        fromPageIndex >= pages.length ||
        toPageIndex < 0 ||
        toPageIndex >= pages.length
      ) {
        throw invalidSessionError();
      }
      const orderedPages = reorderPageRecords(pages, fromPageIndex, toPageIndex, updatedAt);
      orderedPages.forEach((value) => {
        store.put(value);
      });
      await transactionDone(transaction);
      return orderedPages;
    } finally {
      database.close();
    }
  }

  async read(): Promise<ViewerSession | null> {
    const database = await this.open();
    try {
      const transaction = database.transaction([VIEWER_DOCUMENT_STORE_NAME, VIEWER_PAGE_STORE_NAME], "readonly");
      const documentValue = await requestToPromise(transaction.objectStore(VIEWER_DOCUMENT_STORE_NAME).get(ACTIVE_VIEWER_SESSION_ID));
      if (documentValue === undefined) {
        await transactionDone(transaction);
        return null;
      }
      const document = validateDocument(documentValue);
      const pages = validatePages(await requestToPromise(transaction.objectStore(VIEWER_PAGE_STORE_NAME).getAll()));
      const currentPage = pages.find((page) => page.pageId === document.currentPageId);
      if (!currentPage) {
        throw invalidSessionError();
      }
      await transactionDone(transaction);
      return {
        document,
        pages,
        currentPage,
      };
    } finally {
      database.close();
    }
  }

  async readPageBlobRecord(pageId: string): Promise<ViewerPageBlobRecord | null> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_PAGE_BLOB_STORE_NAME, "readonly");
      const value = await requestToPromise(transaction.objectStore(VIEWER_PAGE_BLOB_STORE_NAME).get(pageId));
      await transactionDone(transaction);
      return value === undefined ? null : validatePageBlob(value);
    } finally {
      database.close();
    }
  }

  async readPageMetadata(pageId: string): Promise<unknown | null> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_PAGE_METADATA_STORE_NAME, "readonly");
      const value = await requestToPromise(transaction.objectStore(VIEWER_PAGE_METADATA_STORE_NAME).get(pageId));
      await transactionDone(transaction);
      return value === undefined ? null : validatePageMetadata(value).metadata;
    } finally {
      database.close();
    }
  }

  async readPageMetadataIds(): Promise<Set<string>> {
    const database = await this.open();
    try {
      const transaction = database.transaction(VIEWER_PAGE_METADATA_STORE_NAME, "readonly");
      const values = await requestToPromise(transaction.objectStore(VIEWER_PAGE_METADATA_STORE_NAME).getAll());
      await transactionDone(transaction);
      return new Set(values.map((value) => validatePageMetadata(value).pageId));
    } finally {
      database.close();
    }
  }

  async delete(): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(allStores, "readwrite");
      allStores.forEach((storeName) => {
        transaction.objectStore(storeName).clear();
      });
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(VIEWER_SESSION_DB_NAME, VIEWER_SESSION_DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        createStore(database, VIEWER_DOCUMENT_STORE_NAME, "id");
        createStore(database, VIEWER_PAGE_STORE_NAME, "pageId");
        createStore(database, VIEWER_PAGE_BLOB_STORE_NAME, "pageId");
        createStore(database, VIEWER_PAGE_METADATA_STORE_NAME, "pageId");
        createStore(database, VIEWER_CONFIG_STORE_NAME, "id");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open viewer session database."));
      request.onblocked = () => reject(new Error("Viewer session database upgrade was blocked."));
    });
  }
}

function createStore(database: IDBDatabase, name: string, keyPath: string) {
  if (!database.objectStoreNames.contains(name)) {
    database.createObjectStore(name, { keyPath });
  }
}

export function validateViewerSession(value: unknown): ViewerSession {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const document = validateDocument(value.document);
  const pages = validatePages(value.pages);
  const currentPage = validatePage(value.currentPage);
  if (currentPage.pageId !== document.currentPageId || !pages.some((page) => page.pageId === currentPage.pageId)) {
    throw invalidSessionError();
  }
  return {
    document,
    pages,
    currentPage,
  };
}

export function reorderPageRecords(pages: ViewerPageRecord[], fromPageIndex: number, toPageIndex: number, updatedAt: number): ViewerPageRecord[] {
  const orderedPages = [...pages];
  const [page] = orderedPages.splice(fromPageIndex, 1);
  orderedPages.splice(toPageIndex, 0, page);
  return orderedPages.map((value, index) => ({
    ...value,
    sequenceNumber: index + 1,
    updatedAt,
  }));
}

export function insertPageRecords(pages: ViewerPageRecord[], insertIndex: number, newPages: ViewerPageRecord[], updatedAt: number): ViewerPageRecord[] {
  const orderedPages = [...pages];
  orderedPages.splice(insertIndex, 0, ...newPages);
  return orderedPages.map((value, index) => ({
    ...value,
    sequenceNumber: index + 1,
    updatedAt,
  }));
}

export function removePageRecords(pages: ViewerPageRecord[], pageIds: Set<string>, updatedAt: number): ViewerPageRecord[] {
  const orderedPages = pages.filter((page) => !pageIds.has(page.pageId));
  if (!orderedPages.length || orderedPages.length === pages.length) {
    throw invalidSessionError();
  }
  return orderedPages.map((value, index) => ({
    ...value,
    sequenceNumber: index + 1,
    updatedAt,
  }));
}

function validateDocument(value: unknown): ViewerDocumentRecord {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const fileName = value.fileName;
  const fileType = value.fileType;
  const fileBlob = value.fileBlob;
  const currentPageId = value.currentPageId;
  const updatedAt = value.updatedAt;
  if (
    value.id !== ACTIVE_VIEWER_SESSION_ID ||
    typeof fileName !== "string" ||
    fileName.trim() === "" ||
    typeof fileType !== "string" ||
    !(fileBlob instanceof Blob) ||
    typeof currentPageId !== "string" ||
    currentPageId.trim() === "" ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0
  ) {
    throw invalidSessionError();
  }
  return {
    id: ACTIVE_VIEWER_SESSION_ID,
    fileName,
    fileType,
    fileBlob,
    currentPageId,
    updatedAt,
  };
}

function validatePages(value: unknown): ViewerPageRecord[] {
  if (!Array.isArray(value) || !value.length) {
    throw invalidSessionError();
  }
  return value.map(validatePage).sort((left, right) => left.sequenceNumber - right.sequenceNumber);
}

function validatePage(value: unknown): ViewerPageRecord {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const pageId = value.pageId;
  const sequenceNumber = value.sequenceNumber;
  const sourcePageIndex = value.sourcePageIndex;
  const updatedAt = value.updatedAt;
  if (
    typeof pageId !== "string" ||
    pageId.trim() === "" ||
    value.documentId !== ACTIVE_VIEWER_SESSION_ID ||
    typeof sequenceNumber !== "number" ||
    !Number.isInteger(sequenceNumber) ||
    sequenceNumber < 1 ||
    typeof sourcePageIndex !== "number" ||
    !Number.isInteger(sourcePageIndex) ||
    sourcePageIndex < 0 ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0
  ) {
    throw invalidSessionError();
  }
  return {
    pageId,
    documentId: ACTIVE_VIEWER_SESSION_ID,
    sequenceNumber,
    sourcePageIndex,
    updatedAt,
  };
}

function validatePageBlob(value: unknown): ViewerPageBlobRecord {
  const updatedAt = isRecord(value) ? value.updatedAt : null;
  const sourceType = isRecord(value) ? value.sourceType : null;
  const width = isRecord(value) ? value.width : null;
  const height = isRecord(value) ? value.height : null;
  const xResolution = isRecord(value) ? value.xResolution : null;
  const yResolution = isRecord(value) ? value.yResolution : null;
  const documentType = isRecord(value) ? value.documentType : null;
  const physicalWidth = isRecord(value) ? value.physicalWidth : null;
  const physicalHeight = isRecord(value) ? value.physicalHeight : null;
  if (
    !isRecord(value) ||
    typeof value.pageId !== "string" ||
    value.pageId.trim() === "" ||
    !(value.blob instanceof Blob) ||
    !isDocType(sourceType) ||
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height <= 0 ||
    typeof xResolution !== "number" ||
    !Number.isFinite(xResolution) ||
    xResolution <= 0 ||
    typeof yResolution !== "number" ||
    !Number.isFinite(yResolution) ||
    yResolution <= 0 ||
    typeof documentType !== "string" ||
    documentType.trim() === "" ||
    typeof physicalWidth !== "number" ||
    !Number.isFinite(physicalWidth) ||
    physicalWidth <= 0 ||
    typeof physicalHeight !== "number" ||
    !Number.isFinite(physicalHeight) ||
    physicalHeight <= 0 ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0
  ) {
    throw invalidSessionError();
  }
  return {
    pageId: value.pageId,
    blob: value.blob,
    sourceType,
    width,
    height,
    xResolution,
    yResolution,
    documentType,
    physicalWidth,
    physicalHeight,
    updatedAt,
  };
}

function validatePageMetadata(value: unknown): ViewerPageMetadataRecord {
  const updatedAt = isRecord(value) ? value.updatedAt : null;
  if (
    !isRecord(value) ||
    typeof value.pageId !== "string" ||
    value.pageId.trim() === "" ||
    !Object.prototype.hasOwnProperty.call(value, "metadata") ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    updatedAt <= 0
  ) {
    throw invalidSessionError();
  }
  return {
    pageId: value.pageId,
    metadata: value.metadata,
    updatedAt,
  };
}

function validateViewerConfig(value: unknown): ViewerConfig {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const formats = value.formats;
  const tolerance = value.tolerance;
  const view = value.view;
  const exportConfig = value.export;
  if (
    value.id !== VIEWER_CONFIG_ID ||
    !Array.isArray(formats) ||
    !formats.length ||
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    !isRecord(view) ||
    !isRecord(exportConfig)
  ) {
    throw invalidSessionError();
  }
  return {
    formats: formats.map(validatePageFormat),
    tolerance,
    view: validateRasterConfig(view),
    export: validateExportConfig(exportConfig),
  };
}

function validatePageFormat(value: unknown) {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const name = value.name;
  const width = value.width;
  const height = value.height;
  if (
    typeof name !== "string" ||
    name.trim() === "" ||
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw invalidSessionError();
  }
  return {
    name,
    width,
    height,
  };
}

function validateRasterConfig(value: unknown): RasterConfig {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const pdfRasterDpi = value.pdfRasterDpi;
  const maxRasterPixels = value.maxRasterPixels;
  const maxRasterWidth = value.maxRasterWidth;
  const maxRasterHeight = value.maxRasterHeight;
  if (
    typeof pdfRasterDpi !== "number" ||
    !Number.isFinite(pdfRasterDpi) ||
    pdfRasterDpi <= 0 ||
    typeof maxRasterPixels !== "number" ||
    !Number.isFinite(maxRasterPixels) ||
    maxRasterPixels <= 0 ||
    typeof maxRasterWidth !== "number" ||
    !Number.isFinite(maxRasterWidth) ||
    maxRasterWidth <= 0 ||
    typeof maxRasterHeight !== "number" ||
    !Number.isFinite(maxRasterHeight) ||
    maxRasterHeight <= 0
  ) {
    throw invalidSessionError();
  }
  return {
    pdfRasterDpi,
    maxRasterPixels,
    maxRasterWidth,
    maxRasterHeight,
  };
}

function validateExportConfig(value: unknown): ExportConfig {
  const raster = validateRasterConfig(value);
  if (!isRecord(value)) {
    throw invalidSessionError();
  }
  const tiff = value.tiff;
  if (!isRecord(tiff)) {
    throw invalidSessionError();
  }
  const compression = tiff.compression;
  const pixelFormat = tiff.pixelFormat;
  if (
    typeof compression !== "number" ||
    !Number.isInteger(compression) ||
    compression < 0 ||
    !isTiffPixelFormat(pixelFormat)
  ) {
    throw invalidSessionError();
  }
  return {
    ...raster,
    tiff: {
      compression,
      pixelFormat,
    },
  };
}

function isTiffPixelFormat(value: unknown): value is TiffPixelFormat {
  return value === TIFF_PIXEL_FORMAT_BW1 ||
    value === TIFF_PIXEL_FORMAT_GRAY8 ||
    value === TIFF_PIXEL_FORMAT_RGB24;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Viewer session database request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Viewer session database transaction was aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Viewer session database transaction failed."));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocType(value: unknown): value is DocType {
  return value === "tiff" || value === "pdf" || value === "png" || value === "jpeg";
}

function invalidSessionError() {
  return new Error("Stored viewer session is invalid.");
}

const allStores = [
  VIEWER_DOCUMENT_STORE_NAME,
  VIEWER_PAGE_STORE_NAME,
  VIEWER_PAGE_BLOB_STORE_NAME,
  VIEWER_PAGE_METADATA_STORE_NAME,
];
