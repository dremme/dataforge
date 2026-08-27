import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import type { NotificationVariant } from "@/shared/notifications/notifications";
import type { FileImportResponse } from "@/shared/types";

export const JPEG_QUALITY = 0.95;

export interface FrameCapture {
  frameMode: boolean;
  ready: boolean;
  saving: boolean;
  toggleFrameMode: () => void;
  exitFrameMode: () => void;
  stepFrame: (direction: -1 | 1) => void;
  saveFrame: () => void;
}

export function frameTargetStem(path: string): string {
  const base = pathBaseName(path);
  const dot = base.lastIndexOf(".");
  // dot > 0, not !== -1, so a dotfile name (.gif) keeps its name instead of the stamp.
  return dot > 0 ? base.slice(0, dot) : base;
}

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
