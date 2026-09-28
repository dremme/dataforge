import { useId } from "react";
import { classNames } from "@/shared/lib/classNames";
import type { ThemePreference } from "@/shared/types";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; title: string; description: string }> = [
  { value: "system", title: "System", description: "Match the OS" },
  { value: "light", title: "Light", description: "Always light" },
  { value: "dark", title: "Dark", description: "Always dark" },
];

function WindowSketch() {
  return (
    <span className="theme-option__window">
      <span className="theme-option__bar" />
      <span className="theme-option__side" />
      <span className="theme-option__lines">
        <span className="theme-option__line theme-option__line--accent" />
        <span className="theme-option__line" />
        <span className="theme-option__line theme-option__line--short" />
      </span>
    </span>
  );
}

interface ThemePickerProps {
  value: ThemePreference;
  disabled: boolean;
  onChange: (value: ThemePreference) => void;
}

export function ThemePicker({ value, disabled, onChange }: ThemePickerProps) {
  const name = useId();

  return (
    <div className="theme-picker" role="radiogroup" aria-label="Color scheme">
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={classNames("theme-option", value === option.value && "theme-option--selected")}
        >
          <input
            type="radio"
            name={name}
            className="theme-option__input"
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span
            className={`theme-option__preview theme-option__preview--${option.value}`}
            aria-hidden="true"
          >
            {option.value === "system" ? (
              <>
                <span className="theme-option__half theme-option__half--light">
                  <WindowSketch />
                </span>
                <span className="theme-option__half theme-option__half--dark">
                  <WindowSketch />
                </span>
              </>
            ) : (
              <WindowSketch />
            )}
          </span>
          <span className="theme-option__caption">
            <span className="theme-option__title">{option.title}</span>
            <span className="theme-option__description">{option.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
