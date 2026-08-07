import { useId } from "react";
import { classNames } from "@/shared/lib/classNames";

export interface RadioTileOption<T extends string> {
  value: T;
  title: string;
  /** Omit for tiles whose title says everything, e.g. an opacity percentage. */
  description?: string;
}

interface RadioTileGroupProps<T extends string> {
  value: T;
  options: ReadonlyArray<RadioTileOption<T>>;
  /** Field label above the tiles. */
  label: string;
  /** Radio group name; unique per group so two groups in one dialog stay independent. */
  name: string;
  /** Accessible name for the group, e.g. "Watermark size". */
  groupLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}

/** A row of selectable tiles backed by native radios. */
export function RadioTileGroup<T extends string>({
  value,
  options,
  label,
  name,
  groupLabel,
  disabled = false,
  onChange,
}: RadioTileGroupProps<T>) {
  const idPrefix = useId();

  return (
    <div className="dialog__field">
      <div className="dialog__label">{label}</div>
      <div className="dialog__options" role="radiogroup" aria-label={groupLabel}>
        {options.map((option) => {
          const inputId = `${idPrefix}-${option.value}`;

          return (
            <label
              key={option.value}
              className={classNames(
                "dialog__option",
                value === option.value && "dialog__option--selected",
              )}
              htmlFor={inputId}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                className="dialog__radio-input"
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                disabled={disabled}
              />
              <span className="dialog__radio" aria-hidden="true" />
              <div className="dialog__option-content">
                <span className="dialog__option-title">{option.title}</span>
                {option.description && (
                  <span className="dialog__option-desc">{option.description}</span>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
