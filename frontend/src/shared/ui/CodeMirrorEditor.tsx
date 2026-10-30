import { closeCompletion, completionStatus } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
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
import { classNames } from "@/shared/lib/classNames";
import { closeCodeEditorSearchPanel } from "@/shared/lib/codeEditorSearch";
import { useEditorOptions } from "@/shared/preferences/editorPreferences";
import {
  getCodeEditorHighlightExtension,
  type CodeEditorLanguage,
} from "@/shared/lib/codeEditorTheme";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

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
  if (language === "yaml") return yaml();
  return [];
}

function focusAtEnd(view: EditorView) {
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
}

export interface CodeMirrorEditorProps {
  language: CodeEditorLanguage;
  id?: string;
  value: string;
  placeholder?: string;
  className?: string;
  editable?: boolean;
  /** Focus the editor once it exists, with the cursor at the end of the text. */
  autoFocus?: boolean;
  /** Extra extensions merged after the built-in language/search setup. */
  extensions?: Extension[];
  /** Defaults to on, in English, for Markdown and plain text. */
  spellcheck?: boolean;
  spellcheckLanguage?: string;
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
      autoFocus = false,
      extensions: extraExtensions,
      spellcheck = language === "markdown" || language === "plaintext",
      spellcheckLanguage = "en",
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
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useLatestRef(onChange);
    const handleChange = useCallback(
      (next: string) => {
        onChangeRef.current(next);
      },
      [onChangeRef],
    );

    const { lineWrap, lineNumbers } = useEditorOptions();
    const basicSetup = useMemo(() => ({ ...CODE_MIRROR_BASIC_SETUP, lineNumbers }), [lineNumbers]);

    const onBlurRef = useLatestRef(onBlur);

    // First Escape dismisses a completion list or the find panel; host dialogs must not see it.
    const handleKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;

      const view = viewRef.current;
      if (view && completionStatus(view.state) !== null) {
        closeCompletion(view);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!closeCodeEditorSearchPanel(rootRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    }, []);

    const handleBlur = useCallback(
      (event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onBlurRef.current?.();
      },
      [onBlurRef],
    );

    const extensions = useMemo(() => {
      const attrs: Record<string, string> = {
        tabindex: "0",
      };
      if (spellcheck) {
        attrs.spellcheck = "true";
        attrs.lang = spellcheckLanguage;
      } else {
        attrs.spellcheck = "false";
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
        lineWrap ? EditorView.lineWrapping : [],
        EditorView.contentAttributes.of(attrs),
        EditorView.domEventHandlers({
          wheel(event) {
            event.stopPropagation();
            return false;
          },
        }),
        ...(extraExtensions ?? []),
      ];

      if (id) {
        viewExtensions.push(EditorView.editorAttributes.of({ id }));
      }

      return viewExtensions;
    }, [
      ariaInvalid,
      ariaLabel,
      extraExtensions,
      id,
      language,
      lineWrap,
      spellcheck,
      spellcheckLanguage,
      title,
    ]);

    return (
      <div
        ref={rootRef}
        className={classNames("code-editor", className)}
        data-scroll-lock-allow
        onKeyDownCapture={handleKeyDownCapture}
        onBlur={handleBlur}
      >
        <CodeMirror
          ref={(instance) => {
            viewRef.current = instance?.view ?? null;
            if (typeof ref === "function") ref(instance);
            else if (ref) ref.current = instance;
          }}
          id={id}
          className="code-editor__codemirror"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          title={title}
          editable={editable}
          extensions={extensions}
          onCreateEditor={autoFocus ? focusAtEnd : undefined}
          theme="none"
          basicSetup={basicSetup}
          onChange={handleChange}
        />
      </div>
    );
  },
);
