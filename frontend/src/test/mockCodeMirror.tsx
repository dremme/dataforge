import { forwardRef } from "react";

interface MockCodeMirrorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  title?: string;
}

export const MockCodeMirror = forwardRef<HTMLTextAreaElement, MockCodeMirrorProps>(
  function MockCodeMirror(
    {
      value,
      onChange,
      placeholder,
      className,
      id,
      "aria-label": ariaLabel,
      "aria-invalid": ariaInvalid,
      title,
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
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
);
