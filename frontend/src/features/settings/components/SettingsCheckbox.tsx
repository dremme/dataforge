import { useId } from "react";

interface SettingsCheckboxProps {
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

export function SettingsCheckbox({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: SettingsCheckboxProps) {
  const id = useId();

  return (
    <div className="dialog__field">
      <label className="dialog__checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="dialog__checkbox-input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="dialog__checkbox-box" aria-hidden="true" />
        <span className="dialog__checkbox-label">{label}</span>
      </label>
      {hint && <p className="dialog__hint">{hint}</p>}
    </div>
  );
}
