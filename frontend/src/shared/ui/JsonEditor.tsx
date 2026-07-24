import { CodeMirrorEditor, type CodeMirrorEditorProps } from "./CodeMirrorEditor";

export type JsonEditorProps = Omit<CodeMirrorEditorProps, "language">;

export function JsonEditor(props: JsonEditorProps) {
  return <CodeMirrorEditor language="json" {...props} />;
}
