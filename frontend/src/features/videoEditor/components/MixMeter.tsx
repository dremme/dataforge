import { useEffect, useRef, useState } from "react";
import { VIDEO_PROJECT_TRUE_PEAK_CEILING_DB } from "@/shared/constants";
import { classNames } from "@/shared/lib/classNames";
import { useEnginePlaying } from "@/features/videoEditor/hooks/usePlayhead";
import {
  HOLD_FALL_DB_PER_SECOND,
  meterAlarm,
  meterFraction,
  toDecibels,
  type MeterAlarm,
} from "@/features/videoEditor/lib/meter";
import type { PreviewEngine } from "@/features/videoEditor/lib/previewEngine";

function formatDb(db: number): string {
  return Number.isFinite(db) ? `${db > 0 ? "+" : ""}${db.toFixed(1)}` : "-inf";
}

/**
 * The preview mix's sample peaks per channel, read every frame while playing. The bars are
 * written straight to the DOM, as the playhead is; only the held alarm goes through React.
 */
export function MixMeter({ engine }: { engine: PreviewEngine }) {
  const { playing } = useEnginePlaying(engine);
  const barRefs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const [held, setHeld] = useState(-Infinity);
  const [alarm, setAlarm] = useState<MeterAlarm>(null);
  const heldRef = useRef(-Infinity);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const reading = engine.readMeter();
      const levels = reading ? [reading.left, reading.right].map(toDecibels) : [];
      levels.forEach((db, index) => {
        const bar = barRefs[index].current;
        if (bar) bar.style.width = `${meterFraction(db) * 100}%`;
      });
      const loudest = Math.max(-Infinity, ...levels);
      const fallen = heldRef.current - (HOLD_FALL_DB_PER_SECOND * (now - last)) / 1000;
      const next = Math.max(loudest, fallen);
      if (Math.abs(next - heldRef.current) >= 0.1 || !Number.isFinite(next)) {
        heldRef.current = next;
        setHeld(next);
      }
      const raised = meterAlarm(loudest);
      if (raised) setAlarm((current) => (current === "clip" ? current : raised));
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const ref of barRefs) if (ref.current) ref.current.style.width = "0%";
    };
    // The refs are stable; listing them would only restart the loop for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, playing]);

  const description =
    alarm === "clip"
      ? "The preview mix went over full scale and clipped. Lower the gain of the loudest clips, " +
        "or let the export's limiter catch it."
      : alarm === "hot"
        ? `The preview mix went above ${VIDEO_PROJECT_TRUE_PEAK_CEILING_DB} dB; the export's ` +
          "limiter will hold it there."
        : "Sample peaks of the preview mix. Click to clear the warning.";
  return (
    <button
      type="button"
      className={classNames("video-editor__meter", alarm && `video-editor__meter--${alarm}`)}
      title={description}
      aria-label={`Mix level: peak ${formatDb(held)} dB${alarm === "clip" ? ", clipped" : ""}`}
      onClick={() => {
        setAlarm(null);
        heldRef.current = -Infinity;
        setHeld(-Infinity);
      }}
    >
      <span className="video-editor__meter-bars" aria-hidden="true">
        {barRefs.map((ref, index) => (
          <span key={index} className="video-editor__meter-track">
            <span ref={ref} className="video-editor__meter-fill" />
          </span>
        ))}
      </span>
      <span className="video-editor__meter-value">
        {alarm === "clip" ? "Clip" : formatDb(held)}
      </span>
    </button>
  );
}
