import { useId, useRef } from "react";
import type { MouseEvent } from "react";

export interface DialogSelectOption<T extends string> {
  value: T;
  title: string;
}

interface DialogSelectProps<T extends string> {
  /** Field label above the control. */
  label: string;
  value: T;
  options: ReadonlyArray<DialogSelectOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
}

/** A labelled native select in the dialog form styling. */
export function DialogSelect<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: DialogSelectProps<T>) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const selectId = useId();

  // The wrap carries the padding that keeps the UA arrow off the border, so a click in that
  // gutter lands on the div and never reaches the select. Open the picker by hand instead.
  const handleWrapMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const select = selectRef.current;
    if (!select || select.disabled || event.target === select) return;

    // Otherwise the div takes focus off the select.
    event.preventDefault();
    select.focus();
    if (typeof select.showPicker === "function") select.showPicker();
  };

  return (
    <div className="dialog__field">
      <label htmlFor={selectId} className="dialog__label">
        {label}
      </label>
      <div className="dialog__select-wrap" onMouseDown={handleWrapMouseDown}>
        <select
          id={selectId}
          ref={selectRef}
          className="dialog__select"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
