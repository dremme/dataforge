import { useState } from "react";

interface SizeNumberFieldProps {
  label: string;
  value: number;
  min: number;
  step: number;
  disabled: boolean;
  className: string;
  onCommit: (value: number) => void;
}

export function SizeNumberField({
  label,
  value,
  min,
  step,
  disabled,
  className,
  onCommit,
}: SizeNumberFieldProps) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <label className={className}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={typed ?? value}
        disabled={disabled}
        onChange={(event) => {
          const text = event.target.value;
          setTyped(text);
          const parsed = Number(text);
          if (Number.isFinite(parsed) && parsed >= min) onCommit(parsed);
        }}
        onBlur={() => {
          if (typed !== null) {
            const parsed = Number(typed);
            if (Number.isFinite(parsed) && parsed >= min) onCommit(parsed);
          }
          setTyped(null);
        }}
      />
    </label>
  );
}
