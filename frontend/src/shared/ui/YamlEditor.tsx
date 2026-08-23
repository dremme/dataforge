import { CodeMirrorEditor, type CodeMirrorEditorProps } from "./CodeMirrorEditor";

export type YamlEditorProps = Omit<CodeMirrorEditorProps, "language">;

export function YamlEditor(props: YamlEditorProps) {
  return <CodeMirrorEditor language="yaml" {...props} />;
}
