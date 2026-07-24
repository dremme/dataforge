import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import CodeMirror from "@uiw/react-codemirror";
import { forwardRef, useMemo } from "react";
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

      const viewExtensions = [
        languageExtension(language),
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
      <div className={["code-editor", className].filter(Boolean).join(" ")} data-scroll-lock-allow>
        <CodeMirror
          ref={ref}
          className="code-editor__codemirror"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          title={title}
          extensions={extensions}
          theme={getCodeEditorTheme(language)}
          basicSetup={CODE_MIRROR_BASIC_SETUP}
          onChange={onChange}
        />
      </div>
    );
  },
);
