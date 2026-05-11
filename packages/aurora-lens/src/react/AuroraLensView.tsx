import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { AuroraLens } from "../core/AuroraLens";
import type { AuroraLensOptions } from "../core/types";

export const AuroraLensView = forwardRef<AuroraLens, AuroraLensOptions>(function AuroraLensView(options, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<AuroraLens | null>(null);
  const optionsRef = useRef(options);

  optionsRef.current = options;

  useLayoutEffect(() => {
    if (!hostRef.current) {
      return;
    }
    lensRef.current = new AuroraLens(hostRef.current, {
      decoder: options.decoder,
      selectionTheme: options.selectionTheme,
      onError: (error) => optionsRef.current.onError?.(error),
      onStateChange: (state) => optionsRef.current.onStateChange?.(state),
      onStatusChange: (status) => optionsRef.current.onStatusChange?.(status),
      onThumbnailSelect: (pageIndex) => optionsRef.current.onThumbnailSelect?.(pageIndex),
    });
    return () => {
      lensRef.current?.close();
      lensRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => lensRef.current!, []);

  return <div ref={hostRef} />;
});
