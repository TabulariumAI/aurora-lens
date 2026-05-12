export const VIEWER_SESSION_DB_NAME = "aurora-lens-web";
export const VIEWER_SESSION_DB_VERSION = 2;
export const VIEWER_DOCUMENT_STORE_NAME = "viewer-documents";
export const VIEWER_PAGE_STORE_NAME = "viewer-pages";
export const VIEWER_PAGE_BLOB_STORE_NAME = "viewer-page-blobs";
export const VIEWER_PAGE_METADATA_STORE_NAME = "viewer-page-metadata";
export const ACTIVE_VIEWER_SESSION_ID = "active";

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
  saveCurrentPage(pageId: string, updatedAt: number): Promise<void>;
  savePageBlob(record: ViewerPageBlobRecord): Promise<void>;
  savePageMetadata(record: ViewerPageMetadataRecord): Promise<void>;
  reorderPages(fromPageIndex: number, toPageIndex: number, updatedAt: number): Promise<ViewerPageRecord[]>;
  read(): Promise<ViewerSession | null>;
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
        Array.from(database.objectStoreNames).forEach((storeName) => {
          database.deleteObjectStore(storeName);
        });
        database.createObjectStore(VIEWER_DOCUMENT_STORE_NAME, { keyPath: "id" });
        database.createObjectStore(VIEWER_PAGE_STORE_NAME, { keyPath: "pageId" });
        database.createObjectStore(VIEWER_PAGE_BLOB_STORE_NAME, { keyPath: "pageId" });
        database.createObjectStore(VIEWER_PAGE_METADATA_STORE_NAME, { keyPath: "pageId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open viewer session database."));
      request.onblocked = () => reject(new Error("Viewer session database upgrade was blocked."));
    });
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

function invalidSessionError() {
  return new Error("Stored viewer session is invalid.");
}

const allStores = [
  VIEWER_DOCUMENT_STORE_NAME,
  VIEWER_PAGE_STORE_NAME,
  VIEWER_PAGE_BLOB_STORE_NAME,
  VIEWER_PAGE_METADATA_STORE_NAME,
];
