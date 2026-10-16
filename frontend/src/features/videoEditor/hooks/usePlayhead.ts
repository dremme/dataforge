import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  MediaProblem,
  PreviewEngine,
  PreviewFidelity,
} from "@/features/videoEditor/lib/previewEngine";

/** Readouts redraw a few times a second; the playhead line itself is moved without React. */
const READOUT_INTERVAL_MS = 100;

export function usePlayheadTime(engine: PreviewEngine): number {
  const [time, setTime] = useState(engine.currentTime);
  useEffect(() => {
    let last = 0;
    let trailing = 0;
    const unsubscribe = engine.subscribe((next) => {
      window.clearTimeout(trailing);
      const now = performance.now();
      if (now - last >= READOUT_INTERVAL_MS) {
        last = now;
        setTime(next);
      } else {
        trailing = window.setTimeout(() => setTime(engine.currentTime), READOUT_INTERVAL_MS);
      }
    });
    return () => {
      window.clearTimeout(trailing);
      unsubscribe();
    };
  }, [engine]);
  return time;
}

export function useEnginePlaying(engine: PreviewEngine): { playing: boolean; waiting: boolean } {
  const playing = useSyncExternalStore(
    (listener) => engine.subscribeState(listener),
    () => engine.isPlaying,
  );
  const waiting = useSyncExternalStore(
    (listener) => engine.subscribeState(listener),
    () => engine.isWaiting,
  );
  return { playing, waiting };
}

export function useMediaProblems(engine: PreviewEngine): MediaProblem[] {
  return useSyncExternalStore(
    (listener) => engine.subscribeState(listener),
    () => engine.mediaProblems,
  );
}

export function usePreviewFidelity(engine: PreviewEngine): PreviewFidelity {
  return useSyncExternalStore(
    (listener) => engine.subscribeState(listener),
    () => engine.previewFidelity,
  );
}
