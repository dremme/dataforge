import {
  VIDEO_PROJECT_AUDIO_EXTENSIONS,
  VIDEO_PROJECT_IMAGE_EXTENSIONS,
  VIDEO_PROJECT_VIDEO_EXTENSIONS,
} from "@/shared/constants";

export type EditorMediaKind = "video" | "image" | "audio";

const EXTENSIONS: Record<EditorMediaKind, readonly string[]> = {
  video: VIDEO_PROJECT_VIDEO_EXTENSIONS,
  image: VIDEO_PROJECT_IMAGE_EXTENSIONS,
  audio: VIDEO_PROJECT_AUDIO_EXTENSIONS,
};

export function editorMediaKind(name: string): EditorMediaKind | null {
  const dot = name.lastIndexOf(".");
  const suffix = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  for (const kind of ["video", "image", "audio"] as const) {
    if (EXTENSIONS[kind].includes(suffix)) return kind;
  }
  return null;
}
