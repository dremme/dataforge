import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import CodeMirror from "@uiw/react-codemirror";
import { forwardRef, useCallback, useMemo, useRef, type KeyboardEvent } from "react";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";
import { getCodeEditorTheme, type CodeEditorLanguage } from "@/shared/lib/codeEditorTheme";

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
  return language === "markdown" ? markdown() : json();
}

export interface CodeMirrorEditorProps {
  language: CodeEditorLanguage;
  id?: string;
  value: string;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  title?: string;
  onChange: (value: string) => void;
}

export const CodeMirrorEditor = forwardRef<ReactCodeMirrorRef, CodeMirrorEditorProps>(
  function CodeMirrorEditor(
    {
      language,
      id,
      value,
      placeholder,
      className,
      "aria-label": ariaLabel,
      "aria-invalid": ariaInvalid,
      title,
      onChange,
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

    // First Escape closes the find panel; do not let host dialogs see the key.
    const handleKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      if (!closeCodeEditorSearchPanel(rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    }, []);

    const theme = useMemo(() => getCodeEditorTheme(language), [language]);

    const extensions = useMemo(() => {
      const attrs: Record<string, string> = {
        tabindex: "0",
      };
      if (language === "markdown") {
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

      // search() must be permanent config. basicSetup only adds the keymap; the first
      // Ctrl+F otherwise appends search state via appendConfig, which reconfigure drops.
      const viewExtensions: Extension[] = [
        languageExtension(language),
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
      >
        <CodeMirror
          ref={ref}
          className="code-editor__codemirror"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          title={title}
          extensions={extensions}
          theme={theme}
          basicSetup={CODE_MIRROR_BASIC_SETUP}
          onChange={handleChange}
        />
      </div>
    );
  },
);
