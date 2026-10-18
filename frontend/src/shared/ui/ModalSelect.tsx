import { useId, useRef } from "react";
import type { MouseEvent } from "react";

export interface ModalSelectOption<T extends string> {
  value: T;
  title: string;
  /** Adjacent options naming the same group render under one `<optgroup>`. */
  group?: string;
}

interface OptionRun<T extends string> {
  group: string | undefined;
  options: ModalSelectOption<T>[];
}

function groupAdjacent<T extends string>(
  options: ReadonlyArray<ModalSelectOption<T>>,
): OptionRun<T>[] {
  const runs: OptionRun<T>[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last && option.group && last.group === option.group) {
      last.options.push(option);
    } else {
      runs.push({ group: option.group, options: [option] });
    }
  }
  return runs;
}

function renderOptions<T extends string>(options: ReadonlyArray<ModalSelectOption<T>>) {
  return options.map((option) => (
    <option key={option.value} value={option.value}>
      {option.title}
    </option>
  ));
}

interface ModalSelectProps<T extends string> {
  /** Field label above the control. */
  label: string;
  value: T;
  options: ReadonlyArray<ModalSelectOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
}

/** A labelled native select in the modal form styling. */
export function ModalSelect<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: ModalSelectProps<T>) {
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
    <div className="modal__field">
      <label htmlFor={selectId} className="modal__label">
        {label}
      </label>
      <div className="modal__select-wrap" onMouseDown={handleWrapMouseDown}>
        <select
          id={selectId}
          ref={selectRef}
          className="modal__select"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {groupAdjacent(options).map((run) =>
            run.group ? (
              <optgroup key={`${run.group}:${run.options[0].value}`} label={run.group}>
                {renderOptions(run.options)}
              </optgroup>
            ) : (
              renderOptions(run.options)
            ),
          )}
        </select>
      </div>
    </div>
  );
}
