import { useState } from "react";
import { classNames } from "@/shared/lib/classNames";
import { parseTimecode } from "@/features/videoEditor/lib/timecode";
import { formatTimecode } from "@/features/videoEditor/lib/timeline";
import { useChanged } from "@/shared/hooks/useChanged";

const HINT = "Type a timecode, frames (36f), seconds (1.5s), or +12 / -3 frames; Enter applies.";

interface TimecodeFieldProps {
  label: string;
  value: number;
  frameRate: number;
  /** Seconds on the frame grid; called on Enter or when the field is left changed. */
  onCommit: (seconds: number) => void;
  className?: string;
  disabled?: boolean;
}

/** A time shown as the editor shows it, and typed back exactly; Escape puts it back. */
export function TimecodeField({
  label,
  value,
  frameRate,
  onCommit,
  className,
  disabled = false,
}: TimecodeFieldProps) {
  const shown = formatTimecode(value, frameRate);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  if (useChanged(shown)) {
    setText(shown);
    setInvalid(false);
  }

  const commit = () => {
    if (text.trim() === shown) return;
    const seconds = parseTimecode(text, frameRate, value);
    if (seconds === null || seconds < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatTimecode(seconds, frameRate));
    onCommit(seconds);
  };
  return (
    <input
      className={classNames("video-editor__timecode-field", className)}
      value={text}
      aria-label={label}
      aria-invalid={invalid || undefined}
      title={invalid ? `Not a time this field can read. ${HINT}` : HINT}
      spellCheck={false}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setText(shown);
          setInvalid(false);
        }
      }}
    />
  );
}
