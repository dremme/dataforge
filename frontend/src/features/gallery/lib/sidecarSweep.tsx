import type { ReactNode } from "react";
import { iconFiles, iconMessageWarning, type AppIcon } from "@/shared/icons";
import type { NotifyOptions } from "@/shared/notifications/notifications";
import type { SidecarDeleteResponse, SidecarKind } from "@/shared/types";

/** Issue first, matching the order the two resolvers appear in the palette. */
export const SIDECAR_SWEEP_KINDS = ["issue", "duplicate"] as const;

type SidecarSweepCopy = {
  /**
   * Names the suffix rather than the finding. "Delete all duplicates" would read as
   * deleting the duplicate media, which is the one dangerous misreading available here.
   */
  label: string;
  /** The resolver's icon for the same finding, so the two read as a pair. */
  icon: AppIcon;
  keywords: string;
  singular: string;
  plural: string;
  title: string;
  description: (count: number, folderLabel: string) => ReactNode;
};

export const SIDECAR_SWEEP_COPY: Record<SidecarKind, SidecarSweepCopy> = {
  issue: {
    label: "Delete all .issue.json files",
    icon: iconMessageWarning,
    keywords: "sidecar caption issues verify findings clear flags remove sweep",
    singular: "caption issue file",
    plural: "caption issue files",
    title: "Delete all .issue.json files?",
    description: (count, folderLabel) => (
      <>
        This will delete <strong>{sidecarCountPhrase("issue", count)}</strong> in{" "}
        <strong>{folderLabel}</strong>. Captions and media are left untouched. On Windows, files are
        moved to the Recycle Bin.
      </>
    ),
  },
  duplicate: {
    label: "Delete all .duplicate.json files",
    icon: iconFiles,
    keywords: "sidecar duplicates findings clear flags remove dedupe sweep",
    singular: "duplicate finding file",
    plural: "duplicate finding files",
    title: "Delete all .duplicate.json files?",
    description: (count, folderLabel) => (
      <>
        This will delete <strong>{sidecarCountPhrase("duplicate", count)}</strong> in{" "}
        <strong>{folderLabel}</strong>. The duplicate media themselves are left untouched. On
        Windows, files are moved to the Recycle Bin.
      </>
    ),
  },
};

function sidecarCountPhrase(kind: SidecarKind, count: number): string {
  const copy = SIDECAR_SWEEP_COPY[kind];
  return count === 1 ? `1 ${copy.singular}` : `${count} ${copy.plural}`;
}

/** The palette's second line: whether running it would do anything, and to how much. */
export function sidecarSweepDetail(kind: SidecarKind, count: number): string {
  if (count === 0) return "Nothing to delete";
  return sidecarCountPhrase(kind, count);
}

/**
 * Built from the response rather than from the count the palette showed: that count
 * comes from the last folder listing, and the sweep also clears orphaned sidecars no
 * gallery item ever carried, so the server's number is the only honest one.
 */
export function sidecarSweepOutcome(result: SidecarDeleteResponse): NotifyOptions {
  const { plural } = SIDECAR_SWEEP_COPY[result.kind];
  const deleted = result.deleted.length;
  const failed = result.failed.length;

  if (failed > 0) {
    const [first] = result.failed;
    const extra = failed - 1;
    const failPart =
      extra > 0 ? `Could not delete ${first} and ${extra} more.` : `Could not delete ${first}.`;
    return {
      variant: "danger",
      message: `Deleted ${deleted} of ${deleted + failed} ${plural}. ${failPart}`,
    };
  }

  if (deleted === 0) {
    return { variant: "warning", message: `No ${plural} in this folder.` };
  }

  const phrase = sidecarCountPhrase(result.kind, deleted);
  // The capability, not the platform: a trash backend added later flips this on its own.
  return {
    variant: "success",
    message: result.deletes_to_trash ? `Moved ${phrase} to the Recycle Bin.` : `Deleted ${phrase}.`,
  };
}
