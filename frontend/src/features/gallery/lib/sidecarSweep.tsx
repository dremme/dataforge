import type { ReactNode } from "react";
import type { NotifyOptions } from "@/shared/notifications/notifications";
import type { SidecarDeleteResponse, SidecarKind } from "@/shared/types";

export const SIDECAR_SWEEP_KINDS = ["issue", "duplicate"] as const;

type SidecarSweepCopy = {
  singular: string;
  plural: string;
  title: string;
  description: (count: number, folderLabel: string) => ReactNode;
};

export const SIDECAR_SWEEP_COPY: Record<SidecarKind, SidecarSweepCopy> = {
  issue: {
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

export function sidecarCountPhrase(kind: SidecarKind, count: number): string {
  const copy = SIDECAR_SWEEP_COPY[kind];
  return count === 1 ? `1 ${copy.singular}` : `${count} ${copy.plural}`;
}

/** Built from the response: the palette count is a listing, and the sweep clears orphans. */
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
  return {
    variant: "success",
    message: result.deletes_to_trash ? `Moved ${phrase} to the Recycle Bin.` : `Deleted ${phrase}.`,
  };
}
