import { useId } from "react";
import { classNames } from "@/shared/lib/classNames";

export type AutomationMode = "thinking" | "instruct";

const MODES: ReadonlyArray<{ value: AutomationMode; title: string; description: string }> = [
  { value: "thinking", title: "Reasoning", description: "Slower, but better overall outcome" },
  { value: "instruct", title: "Instruct", description: "Faster, but makes more mistakes" },
];

interface AutomationModeSelectorProps {
  value: AutomationMode;
  /** Radio group name; unique per dialog so stacked dialogs stay independent. */
  name: string;
  /** Accessible name for the group, e.g. "Caption mode". */
  groupLabel: string;
  disabled?: boolean;
  onChange: (mode: AutomationMode) => void;
}

/** Reasoning / Instruct tiles shared by the vision-LLM job dialogs. */
export function AutomationModeSelector({
  value,
  name,
  groupLabel,
  disabled = false,
  onChange,
}: AutomationModeSelectorProps) {
  const idPrefix = useId();

  return (
    <div className="dialog__field">
      <div className="dialog__label">Mode</div>
      <div className="dialog__options" role="radiogroup" aria-label={groupLabel}>
        {MODES.map((mode) => {
          const inputId = `${idPrefix}-${mode.value}`;

          return (
            <label
              key={mode.value}
              className={classNames(
                "dialog__option",
                value === mode.value && "dialog__option--selected",
              )}
              htmlFor={inputId}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                className="dialog__radio-input"
                value={mode.value}
                checked={value === mode.value}
                onChange={() => onChange(mode.value)}
                disabled={disabled}
              />
              <span className="dialog__radio" aria-hidden="true" />
              <div className="dialog__option-content">
                <span className="dialog__option-title">{mode.title}</span>
                <span className="dialog__option-desc">{mode.description}</span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
