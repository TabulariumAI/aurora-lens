import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { AuroraLens } from "../core/AuroraLens";
import { IndexedDbViewerSessionStore } from "../core/viewerSessionStore";
import type { ViewerOptions } from "../core/types";

export const ReactViewer = forwardRef<AuroraLens, ViewerOptions>(function ReactViewer(options, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<AuroraLens | null>(null);
  const optionsRef = useRef(options);

  optionsRef.current = options;

  useLayoutEffect(() => {
    if (!hostRef.current) {
      return;
    }
    lensRef.current = new AuroraLens(hostRef.current, {
      allowEdit: options.allowEdit,
      decoder: options.decoder,
      sessionStore: options.sessionStore ?? new IndexedDbViewerSessionStore(),
      selectionTheme: options.selectionTheme,
      onError: (error) => optionsRef.current.onError?.(error),
      onStateChange: (state) => optionsRef.current.onStateChange?.(state),
      onStatusChange: (status) => optionsRef.current.onStatusChange?.(status),
    });
    optionsRef.current.onReady?.(lensRef.current);
    return () => {
      lensRef.current?.close();
      lensRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    lensRef.current?.setAllowEdit(options.allowEdit);
  }, [options.allowEdit]);

  useImperativeHandle(ref, () => lensRef.current!, []);

  return <div ref={hostRef} />;
});
