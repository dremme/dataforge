import type { CSSProperties } from "react";

/** The thumbnail is a white wave on a clear ground; masking a token keeps it on theme. */
export function AudioWaveform({ src, className }: { src: string; className: string }) {
  return (
    <span
      className={className}
      style={{ "--waveform-src": `url("${src}")` } as CSSProperties}
      aria-hidden="true"
    />
  );
}
