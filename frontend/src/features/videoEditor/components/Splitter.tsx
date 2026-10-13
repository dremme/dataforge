import { useRef, useState } from "react";
import { classNames } from "@/shared/lib/classNames";

interface SplitterProps {
  label: string;
  orientation: "vertical" | "horizontal";
  onResize: (delta: number) => void;
  /** Double-click puts the panel back to its starting size. */
  onReset: () => void;
}

/** The gutter between two panels: drag it, nudge it with arrows, double-click to reset. */
export function Splitter({ label, orientation, onResize, onReset }: SplitterProps) {
  const last = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={classNames(
        "video-editor__splitter",
        `video-editor__splitter--${orientation}`,
        dragging && "video-editor__splitter--dragging",
      )}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      title="Drag to resize; double-click to reset"
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        last.current = orientation === "vertical" ? event.clientX : event.clientY;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;
        const position = orientation === "vertical" ? event.clientX : event.clientY;
        onResize(position - last.current);
        last.current = position;
      }}
      onPointerUp={() => {
        last.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        last.current = null;
        setDragging(false);
      }}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const keys =
          orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        if (event.key === keys[0]) onResize(-step);
        else if (event.key === keys[1]) onResize(step);
        else return;
        event.preventDefault();
      }}
    />
  );
}
