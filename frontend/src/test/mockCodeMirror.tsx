import { forwardRef, useLayoutEffect, useRef, type ForwardedRef } from "react";

/** Just what callers of `onCreateEditor` touch, backed by the textarea. */
function viewFor(textarea: HTMLTextAreaElement) {
  return {
    contentDOM: textarea,
    state: { doc: { length: textarea.value.length } },
    focus: () => textarea.focus(),
    dispatch: ({ selection }: { selection?: { anchor: number } }) => {
      if (selection) textarea.setSelectionRange(selection.anchor, selection.anchor);
    },
  };
}

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

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
  /** Called once after mount, as the real component does when it creates its view. */
  onCreateEditor?: (view: never) => void;
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
      onCreateEditor,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const onCreateRef = useRef(onCreateEditor);
    useLayoutEffect(() => {
      if (textareaRef.current) onCreateRef.current?.(viewFor(textareaRef.current) as never);
    }, []);

    return (
      <textarea
        ref={(element) => {
          textareaRef.current = element;
          assignRef(ref, element);
        }}
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
