import { forwardRef } from "react";

interface MockCodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  editable?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  title?: string;
  onBlur?: () => void;
}

export const MockCodeMirror = forwardRef<HTMLTextAreaElement, MockCodeMirrorProps>(
  function MockCodeMirror(
    {
      value,
      onChange,
      placeholder,
      className,
      id,
      editable = true,
      "aria-label": ariaLabel,
      "aria-invalid": ariaInvalid,
      title,
      onBlur,
    },
    ref,
  ) {
    return (
      <textarea
        ref={ref}
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        title={title}
        disabled={editable === false}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    );
  },
);
