import { useEffect, useRef } from "react";

interface ProgressBarProps {
  text: string;
}

export function ProgressBar({ text }: ProgressBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      rootRef.current
        ?.querySelectorAll(".tabularium-progress-fill, .tabularium-progress-sheen, .tabularium-progress-head-shadow")
        .forEach((element) => {
          element.getAnimations().forEach((animation) => animation.cancel());
        });
    };
  }, []);

  return (
    <div ref={rootRef} className="tabularium-progress" role="status" aria-live="polite">
      <div className="tabularium-progress-text">{text}</div>
      <div className="tabularium-progress-track" role="progressbar" aria-label={text}>
        <div className="tabularium-progress-fill">
          <div className="tabularium-progress-head-shadow" />
          <div className="tabularium-progress-sheen" />
          <div className="tabularium-progress-overlay" />
          <div className="tabularium-progress-overlay" />
          <div className="tabularium-progress-head" />
        </div>
      </div>
    </div>
  );
}
