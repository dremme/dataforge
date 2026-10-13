import { createContext, useContext } from "react";

/** A new project on a video, a saved draft reopened, or an empty project in a folder. */
export type VideoEditorRequest =
  | { kind: "video"; path: string }
  | { kind: "project"; path: string }
  | { kind: "new"; path: string };

export interface VideoEditorLauncher {
  open: (videoPath: string) => void;
  openProject: (projectPath: string) => void;
  isOpen: boolean;
}

export const VideoEditorContext = createContext<VideoEditorLauncher | null>(null);

/** Null outside the app shell, so a view rendered on its own simply offers no editor. */
export function useVideoEditorLauncher(): VideoEditorLauncher | null {
  return useContext(VideoEditorContext);
}
