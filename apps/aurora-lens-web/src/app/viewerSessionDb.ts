export const VIEWER_SESSION_DB_NAME = "aurora-lens-web";
export const VIEWER_SESSION_DB_VERSION = 1;
export const VIEWER_SESSION_STORE_NAME = "viewer-sessions";
export const ACTIVE_VIEWER_SESSION_ID = "active";

export interface ViewerSession {
  id: typeof ACTIVE_VIEWER_SESSION_ID;
  fileName: string;
  fileType: string;
  fileBlob: Blob;
  metadata: unknown | null;
  pageIndex: number;
  updatedAt: number;
}

export async function saveActiveViewerSession(session: ViewerSession): Promise<void> {
  const database = await openViewerSessionDatabase();
  try {
    const transaction = database.transaction(VIEWER_SESSION_STORE_NAME, "readwrite");
    await requestToPromise(transaction.objectStore(VIEWER_SESSION_STORE_NAME).put(session));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function readActiveViewerSession(): Promise<ViewerSession | null> {
  const database = await openViewerSessionDatabase();
  try {
    const transaction = database.transaction(VIEWER_SESSION_STORE_NAME, "readonly");
    const storedSession = await requestToPromise(transaction.objectStore(VIEWER_SESSION_STORE_NAME).get(ACTIVE_VIEWER_SESSION_ID));
    await transactionDone(transaction);
    return storedSession === undefined ? null : validateViewerSession(storedSession);
  } finally {
    database.close();
  }
}

export async function deleteActiveViewerSession(): Promise<void> {
  const database = await openViewerSessionDatabase();
  try {
    const transaction = database.transaction(VIEWER_SESSION_STORE_NAME, "readwrite");
    await requestToPromise(transaction.objectStore(VIEWER_SESSION_STORE_NAME).delete(ACTIVE_VIEWER_SESSION_ID));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

function openViewerSessionDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VIEWER_SESSION_DB_NAME, VIEWER_SESSION_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VIEWER_SESSION_STORE_NAME)) {
        database.createObjectStore(VIEWER_SESSION_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open viewer session database."));
    request.onblocked = () => reject(new Error("Viewer session database upgrade was blocked."));
  });
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

function validateViewerSession(value: unknown): ViewerSession {
  if (!isRecord(value)) {
    throw invalidSessionError();
  }

  const fileName = value.fileName;
  const fileType = value.fileType;
  const fileBlob = value.fileBlob;
  const metadata = value.metadata;
  const pageIndex = value.pageIndex;
  const updatedAt = value.updatedAt;
  if (
    value.id !== ACTIVE_VIEWER_SESSION_ID ||
    typeof fileName !== "string" ||
    fileName.trim() === "" ||
    typeof fileType !== "string" ||
    !(fileBlob instanceof Blob) ||
    !Object.prototype.hasOwnProperty.call(value, "metadata") ||
    metadata === undefined ||
    typeof pageIndex !== "number" ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
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
    metadata,
    pageIndex,
    updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidSessionError() {
  return new Error("Stored viewer session is invalid.");
}
