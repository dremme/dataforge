import { useEffect, useRef, useState, type RefObject } from "react";
import {
  HISTOGRAM_BINS,
  measureFrame,
  WAVEFORM_ROWS,
  type FrameScopes,
} from "@/features/videoEditor/lib/scopes";

/** How often the scopes read the monitor; enough to follow playback without costing it. */
const READ_MS = 200;
/** The picture is read at most this wide; the scopes have fewer columns than that anyway. */
const SAMPLE_WIDTH = 256;
const WAVEFORM_COLUMNS = 128;

function token(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || "gray";
}

/**
 * A luma waveform and an RGB histogram of the monitor as drawn, with how much of the picture is
 * crushed to black or clipped to white, for matching shots and catching clipping by eye.
 */
export function PreviewScopes({ source }: { source: RefObject<HTMLCanvasElement | null> }) {
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const histogramRef = useRef<HTMLCanvasElement>(null);
  const [reading, setReading] = useState<{ crushed: number; clipped: number } | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    const sample = document.createElement("canvas");
    const read = () => {
      const canvas = source.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;
      const width = Math.min(SAMPLE_WIDTH, canvas.width);
      const height = Math.max(1, Math.round((width * canvas.height) / canvas.width));
      sample.width = width;
      sample.height = height;
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      let scopes: FrameScopes;
      try {
        context.drawImage(canvas, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        scopes = measureFrame(pixels.data, width, height, WAVEFORM_COLUMNS);
      } catch {
        setUnreadable(true);
        return;
      }
      setUnreadable(false);
      if (waveformRef.current) drawWaveform(waveformRef.current, scopes);
      if (histogramRef.current) drawHistogram(histogramRef.current, scopes);
      setReading((current) =>
        current?.crushed === scopes.crushed && current.clipped === scopes.clipped
          ? current
          : { crushed: scopes.crushed, clipped: scopes.clipped },
      );
    };
    read();
    const timer = window.setInterval(read, READ_MS);
    return () => window.clearInterval(timer);
  }, [source]);

  const percent = (value: number) =>
    value > 0 && value < 0.01 ? "<1%" : `${Math.round(value * 100)}%`;
  return (
    <div className="video-editor__scopes" role="group" aria-label="Scopes">
      {unreadable ? (
        <p className="video-editor__scopes-note">The scopes cannot read this picture.</p>
      ) : (
        <>
          <figure className="video-editor__scope">
            <canvas
              ref={waveformRef}
              width={WAVEFORM_COLUMNS}
              height={WAVEFORM_ROWS}
              aria-label="Luma waveform"
            />
            <figcaption>Waveform</figcaption>
          </figure>
          <figure className="video-editor__scope">
            <canvas
              ref={histogramRef}
              width={HISTOGRAM_BINS}
              height={WAVEFORM_ROWS}
              aria-label="RGB histogram"
            />
            <figcaption>
              {reading
                ? `Black ${percent(reading.crushed)} · White ${percent(reading.clipped)}`
                : "Histogram"}
            </figcaption>
          </figure>
        </>
      )}
    </div>
  );
}

/** Each cell lights by how many pixels of its column sit at its level, on a log scale. */
function drawWaveform(canvas: HTMLCanvasElement, scopes: FrameScopes) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { columns, waveform } = scopes;
  const peak = Math.log1p(Math.max(1, ...waveform));
  context.clearRect(0, 0, columns, WAVEFORM_ROWS);
  context.fillStyle = token(canvas, "--scope-trace");
  for (let row = 0; row < WAVEFORM_ROWS; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const count = waveform[row * columns + column];
      if (count === 0) continue;
      context.globalAlpha = Math.min(1, 0.25 + Math.log1p(count) / peak);
      context.fillRect(column, row, 1, 1);
    }
  }
  context.globalAlpha = 1;
}

/** The three channels drawn over one another, so where they agree the bars read as white. */
function drawHistogram(canvas: HTMLCanvasElement, scopes: FrameScopes) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, HISTOGRAM_BINS, WAVEFORM_ROWS);
  const channels: [Uint32Array, string][] = [
    [scopes.red, "--scope-red"],
    [scopes.green, "--scope-green"],
    [scopes.blue, "--scope-blue"],
  ];
  const peak = Math.max(1, ...scopes.red, ...scopes.green, ...scopes.blue);
  context.globalCompositeOperation = "lighter";
  for (const [bins, name] of channels) {
    context.fillStyle = token(canvas, name);
    bins.forEach((count, bin) => {
      const height = Math.round((Math.sqrt(count) / Math.sqrt(peak)) * WAVEFORM_ROWS);
      if (height > 0) context.fillRect(bin, WAVEFORM_ROWS - height, 1, height);
    });
  }
  context.globalCompositeOperation = "source-over";
}
