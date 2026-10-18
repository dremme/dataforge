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
    <div className="modal__field">
      <label className="modal__checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="modal__checkbox-input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="modal__checkbox-box" aria-hidden="true" />
        <span className="modal__checkbox-label">{label}</span>
      </label>
      {hint && <p className="modal__hint">{hint}</p>}
    </div>
  );
}
