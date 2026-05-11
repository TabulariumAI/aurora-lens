import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { AuroraLens } from "@tabularium/aurora-lens";
import type { ViewerState } from "../lens/types";
import {
  ACTIVE_VIEWER_SESSION_ID,
  deleteActiveViewerSession,
  readActiveViewerSession,
  saveActiveViewerSession,
  type ViewerSession,
} from "./viewerSessionDb";

const RESTORE_ERROR_MESSAGE = "Could not restore the previous viewer session.";
const TIFF_FILE_TYPE = "image/tiff";
const PAGE_SESSION_WRITE_DELAY_MS = 150;
const LENS_REF_RETRY_DELAY_MS = 0;

export interface SaveViewerSessionInput {
  fileName: string;
  fileType: string;
  fileBlob: Blob;
  metadata: unknown | null;
  pageIndex: number;
  operationId: number;
}

interface UseViewerSessionOptions {
  lensRef: RefObject<AuroraLens | null>;
  lensState: ViewerState;
  onRestoreError: (message: string) => void;
  resetViewerState: (clearInput: boolean) => void;
}

export function useViewerSession({ lensRef, lensState, onRestoreError, resetViewerState }: UseViewerSessionOptions) {
  const activeSessionRef = useRef(false);
  const lastWrittenPageIndexRef = useRef<number | null>(null);
  const operationIdRef = useRef(0);
  const pageWriteTimerRef = useRef<number | null>(null);
  const lensRetryTimerRef = useRef<number | null>(null);
  const restoreStartedRef = useRef(false);

  const clearPageWriteTimer = useCallback(() => {
    if (pageWriteTimerRef.current !== null) {
      window.clearTimeout(pageWriteTimerRef.current);
      pageWriteTimerRef.current = null;
    }
  }, []);

  const clearLensRetryTimer = useCallback(() => {
    if (lensRetryTimerRef.current !== null) {
      window.clearTimeout(lensRetryTimerRef.current);
      lensRetryTimerRef.current = null;
    }
  }, []);

  const isViewerOperationCurrent = useCallback((operationId: number) => operationIdRef.current === operationId, []);

  const beginViewerOperation = useCallback(() => {
    clearPageWriteTimer();
    operationIdRef.current += 1;
    return operationIdRef.current;
  }, [clearPageWriteTimer]);

  const markActiveSession = useCallback((pageIndex: number) => {
    activeSessionRef.current = true;
    lastWrittenPageIndexRef.current = pageIndex;
  }, []);

  const markNoActiveSession = useCallback(() => {
    activeSessionRef.current = false;
    lastWrittenPageIndexRef.current = null;
  }, []);

  const clearSession = useCallback(async (operationId?: number) => {
    if (operationId !== undefined && !isViewerOperationCurrent(operationId)) {
      return;
    }

    clearPageWriteTimer();
    try {
      await deleteActiveViewerSession();
    } finally {
      if (operationId === undefined || isViewerOperationCurrent(operationId)) {
        markNoActiveSession();
      }
    }
  }, [clearPageWriteTimer, isViewerOperationCurrent, markNoActiveSession]);

  const saveViewerSession = useCallback(async (input: SaveViewerSessionInput) => {
    if (!isViewerOperationCurrent(input.operationId)) {
      return;
    }

    const session: ViewerSession = {
      id: ACTIVE_VIEWER_SESSION_ID,
      fileName: input.fileName,
      fileType: input.fileType,
      fileBlob: input.fileBlob,
      metadata: input.metadata,
      pageIndex: input.pageIndex,
      updatedAt: Date.now(),
    };

    try {
      await saveActiveViewerSession(session);
      if (isViewerOperationCurrent(input.operationId)) {
        markActiveSession(input.pageIndex);
      }
    } catch {
      if (isViewerOperationCurrent(input.operationId)) {
        await clearSession(input.operationId);
      }
    }
  }, [clearSession, isViewerOperationCurrent, markActiveSession]);

  const schedulePageSessionUpdate = useCallback((pageIndex: number) => {
    if (!activeSessionRef.current || pageIndex < 0 || lastWrittenPageIndexRef.current === pageIndex) {
      return;
    }

    clearPageWriteTimer();
    pageWriteTimerRef.current = window.setTimeout(() => {
      pageWriteTimerRef.current = null;
      if (!activeSessionRef.current || lastWrittenPageIndexRef.current === pageIndex) {
        return;
      }

      void (async () => {
        try {
          const session = await readActiveViewerSession();
          if (!session) {
            markNoActiveSession();
            return;
          }

          await saveActiveViewerSession({
            ...session,
            pageIndex,
            updatedAt: Date.now(),
          });
          markActiveSession(pageIndex);
        } catch {
          await clearSession();
        }
      })();
    }, PAGE_SESSION_WRITE_DELAY_MS);
  }, [clearPageWriteTimer, clearSession, markActiveSession, markNoActiveSession]);

  useEffect(() => {
    if (lensState.pageIndex < 0 || lensState.pageCount <= 0) {
      return;
    }

    schedulePageSessionUpdate(lensState.pageIndex);
  }, [lensState.pageCount, lensState.pageIndex, schedulePageSessionUpdate]);

  useEffect(() => {
    let cancelled = false;

    const restore = async (lens: AuroraLens, operationId: number) => {
      const isStale = () => cancelled || !isViewerOperationCurrent(operationId);

      try {
        const session = await readActiveViewerSession();
        if (isStale()) {
          return;
        }
        if (!session) {
          markNoActiveSession();
          return;
        }

        resetViewerState(true);
        if (isStale()) {
          return;
        }

        if (session.metadata !== null) {
          await lens.loadMetadata(session.metadata);
          if (isStale()) {
            return;
          }
        }

        await lens.decodeTiff(new File([session.fileBlob], session.fileName, { type: session.fileType || TIFF_FILE_TYPE }), session.pageIndex);
        if (isStale()) {
          return;
        }

        markActiveSession(session.pageIndex);
      } catch {
        if (isStale()) {
          return;
        }

        resetViewerState(true);
        onRestoreError(RESTORE_ERROR_MESSAGE);
        await clearSession(operationId);
      }
    };

    const startWhenLensExists = () => {
      if (cancelled || restoreStartedRef.current) {
        return;
      }

      const lens = lensRef.current;
      if (!lens) {
        lensRetryTimerRef.current = window.setTimeout(startWhenLensExists, LENS_REF_RETRY_DELAY_MS);
        return;
      }

      restoreStartedRef.current = true;
      const operationId = beginViewerOperation();
      void restore(lens, operationId);
    };

    startWhenLensExists();

    return () => {
      cancelled = true;
      restoreStartedRef.current = false;
      clearLensRetryTimer();
    };
  }, [
    beginViewerOperation,
    clearLensRetryTimer,
    clearSession,
    isViewerOperationCurrent,
    lensRef,
    markActiveSession,
    markNoActiveSession,
    onRestoreError,
    resetViewerState,
  ]);

  useEffect(() => () => {
    clearPageWriteTimer();
    clearLensRetryTimer();
  }, [clearLensRetryTimer, clearPageWriteTimer]);

  return {
    beginViewerOperation,
    isViewerOperationCurrent,
    saveViewerSession,
    clearSession,
  };
}
