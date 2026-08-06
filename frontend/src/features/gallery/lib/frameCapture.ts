import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import type { NotificationVariant } from "@/shared/notifications/notifications";
import type { FileImportResponse } from "@/shared/types";

/** Canvas JPEG quality. High enough that the frame stays usable as training data. */
export const JPEG_QUALITY = 0.95;

/**
 * What the modal needs from a frame-capture hook, whatever the source format is.
 *
 * Video scrubs in seconds and GIF in frame indices, so the position itself stays
 * out of this shape: the owner reads `value`/`max` through the bar's props and
 * everything else here is format-neutral. Stated as one interface so the modal
 * can pick a hook and then stop caring which one it got.
 */
export interface FrameCapture {
  frameMode: boolean;
  /** The source is loaded enough to scrub and save. */
  ready: boolean;
  saving: boolean;
  toggleFrameMode: () => void;
  exitFrameMode: () => void;
  stepFrame: (direction: -1 | 1) => void;
  saveFrame: () => void;
}

/** The sibling stem a captured frame is written under, with the extension dropped. */
export function frameTargetStem(path: string): string {
  const base = pathBaseName(path);
  const dot = base.lastIndexOf(".");
  // Guarded on `dot > 0` rather than `!== -1` so a dotfile-shaped name (`.gif`)
  // keeps its name instead of losing it to the stamp.
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Turns the import response into the toast the user sees.
 *
 * Classified on array emptiness rather than name matching — one file goes up, and
 * whether the backend echoes names or paths is not worth depending on. `copied` is
 * checked first so an overwrite that also reports a skip still reads as success.
 */
export function frameSaveOutcome(
  result: FileImportResponse,
  targetName: string,
): { variant: NotificationVariant; message: string } {
  if (result.copied.length > 0) {
    return { variant: "success", message: `Saved frame as ${targetName}.` };
  }
  if (result.rejected.length > 0) {
    return {
      variant: "danger",
      message: `Could not save ${targetName}: the server rejected that file.`,
    };
  }
  if (result.skipped.length > 0) {
    return {
      variant: "warning",
      message: `${targetName} was not saved - the server skipped it.`,
    };
  }
  return {
    variant: "danger",
    message: `Could not save ${targetName}: the server saved nothing.`,
  };
}
