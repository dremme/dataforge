import { useCallback, useRef, type ReactNode } from "react";
import type { EditorView, ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { CodeMirrorEditor, type CodeMirrorEditorProps } from "./CodeMirrorEditor";
import { Icon } from "./Icon";
import {
  iconHeading1,
  iconHeading2,
  iconHeading3,
  iconBold,
  iconItalic,
  iconStrikethrough,
  iconRemoveFormatting,
  iconCode,
  iconList,
  iconListOrdered,
  iconLink,
  iconUnlink,
  iconQuote,
  type AppIcon,
} from "../icons";
import { markdownCommands } from "../utils/markdownCommands";

export type MarkdownEditorProps = Omit<CodeMirrorEditorProps, "language">;

interface ToolbarButtonProps {
  children?: ReactNode;
  icon: AppIcon;
  title?: string;
  onClick?: () => void;
}

function ToolbarButton({ icon, title, onClick }: ToolbarButtonProps) {
  return (
    <button
      className="code-editor-wrapper__toolbar-button"
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      tabIndex={-1}
    >
      <Icon icon={icon} />
    </button>
  );
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const executeCommand = useCallback(
    <K extends keyof typeof markdownCommands>(
      command: K,
      ...args: Parameters<(typeof markdownCommands)[K]> extends [EditorView, ...infer Rest]
        ? Rest
        : never
    ) => {
      const view = editorRef.current?.view;
      if (view) {
        // @ts-expect-error - safe because of the generic constraint above
        markdownCommands[command](view, ...args);
      }
    },
    [],
  );

  return (
    <div className="code-editor-wrapper">
      <div className="code-editor-wrapper__toolbar">
        <div className="code-editor-wrapper__toolbar-button-group code-editor-wrapper__toolbar-button-group--tweak">
          <ToolbarButton
            icon={iconHeading1}
            title="Heading 1"
            onClick={() => executeCommand("heading", 1)}
          />
          <ToolbarButton
            icon={iconHeading2}
            title="Heading 2"
            onClick={() => executeCommand("heading", 2)}
          />
          <ToolbarButton
            icon={iconHeading3}
            title="Heading 3"
            onClick={() => executeCommand("heading", 3)}
          />
        </div>
        <div className="code-editor-wrapper__toolbar-button-group">
          <ToolbarButton icon={iconBold} title="Bold" onClick={() => executeCommand("bold")} />
          <ToolbarButton
            icon={iconItalic}
            title="Italic"
            onClick={() => executeCommand("italic")}
          />
          <ToolbarButton
            icon={iconStrikethrough}
            title="Strikethrough"
            onClick={() => executeCommand("strikethrough")}
          />
        </div>
        <div className="code-editor-wrapper__toolbar-button-group">
          <ToolbarButton icon={iconQuote} title="Quote" onClick={() => executeCommand("quote")} />
          <ToolbarButton icon={iconCode} title="Code" onClick={() => executeCommand("code")} />
        </div>
        <div className="code-editor-wrapper__toolbar-button-group">
          <ToolbarButton
            icon={iconList}
            title="Unordered list"
            onClick={() => executeCommand("unorderedList")}
          />
          <ToolbarButton
            icon={iconListOrdered}
            title="Ordered list"
            onClick={() => executeCommand("orderedList")}
          />
        </div>
        <div className="code-editor-wrapper__toolbar-button-group">
          <ToolbarButton icon={iconLink} title="Link" onClick={() => executeCommand("link")} />
          <ToolbarButton
            icon={iconUnlink}
            title="Remove link"
            onClick={() => executeCommand("removeFormatting")}
          />
        </div>
        <ToolbarButton
          icon={iconRemoveFormatting}
          title="Remove formatting"
          onClick={() => executeCommand("removeFormatting")}
        />
      </div>
      <CodeMirrorEditor ref={editorRef} language="markdown" {...props} />
    </div>
  );
}
