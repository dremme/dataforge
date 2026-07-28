import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import CodeMirror from "@uiw/react-codemirror";
import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";
import {
  getCodeEditorHighlightExtension,
  type CodeEditorLanguage,
} from "@/shared/lib/codeEditorTheme";

const CODE_MIRROR_BASIC_SETUP = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  dropCursor: false,
  indentOnInput: false,
  bracketMatching: false,
  closeBrackets: false,
  autocompletion: false,
} as const;

function languageExtension(language: CodeEditorLanguage): Extension {
  if (language === "markdown") return markdown();
  if (language === "json") return json();
  return [];
}

export interface CodeMirrorEditorProps {
  language: CodeEditorLanguage;
  id?: string;
  value: string;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  title?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

export const CodeMirrorEditor = forwardRef<ReactCodeMirrorRef, CodeMirrorEditorProps>(
  function CodeMirrorEditor(
    {
      language,
      id,
      value,
      placeholder,
      className,
      editable = true,
      "aria-label": ariaLabel,
      "aria-invalid": ariaInvalid,
      title,
      onChange,
      onBlur,
    },
    ref,
  ) {
    // Keep a stable onChange identity. @uiw/react-codemirror reconfigures the whole
    // EditorState when this prop changes, which closes the Ctrl+F search panel.
    const rootRef = useRef<HTMLDivElement>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const handleChange = useCallback((next: string) => {
      onChangeRef.current(next);
    }, []);

    const onBlurRef = useRef(onBlur);
    onBlurRef.current = onBlur;

    // First Escape closes the find panel; do not let host dialogs see the key.
    const handleKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      if (!closeCodeEditorSearchPanel(rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    }, []);

    const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      onBlurRef.current?.();
    }, []);

    const extensions = useMemo(() => {
      const attrs: Record<string, string> = {
        tabindex: "0",
      };
      if (language === "markdown" || language === "plaintext") {
        attrs.spellcheck = "true";
        attrs.lang = "en";
      }
      if (ariaLabel) {
        attrs["aria-label"] = ariaLabel;
      }
      if (ariaInvalid) {
        attrs["aria-invalid"] = "true";
      }
      if (title) {
        attrs.title = title;
      }

      // Chrome lives in SCSS; syntax colors stay in HighlightStyle.
      // search() must be permanent config (basicSetup only adds the keymap).
      const viewExtensions: Extension[] = [
        languageExtension(language),
        getCodeEditorHighlightExtension(language),
        search(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of(attrs),
        EditorView.domEventHandlers({
          wheel(event) {
            event.stopPropagation();
            return false;
          },
        }),
      ];

      if (id) {
        viewExtensions.push(EditorView.editorAttributes.of({ id }));
      }

      return viewExtensions;
    }, [ariaInvalid, ariaLabel, id, language, title]);

    return (
      <div
        ref={rootRef}
        className={["code-editor", className].filter(Boolean).join(" ")}
        data-scroll-lock-allow
        onKeyDownCapture={handleKeyDownCapture}
        onBlur={handleBlur}
      >
        <CodeMirror
          ref={ref}
          id={id}
          className="code-editor__codemirror"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          title={title}
          editable={editable}
          extensions={extensions}
          theme="none"
          basicSetup={CODE_MIRROR_BASIC_SETUP}
          onChange={handleChange}
        />
      </div>
    );
  },
);
