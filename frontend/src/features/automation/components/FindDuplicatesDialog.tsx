import { useCallback, useState } from "react";
import type { DuplicateThreshold } from "@/shared/types";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";

const THRESHOLD_OPTIONS: ReadonlyArray<RadioTileOption<DuplicateThreshold>> = [
  { value: "exact", title: "Exact", description: "Only files that look identical." },
  { value: "near", title: "Near", description: "Crops, re-encodes, and small edits." },
  { value: "loose", title: "Loose", description: "Anything similar. Expect false matches." },
];

interface FindDuplicatesDialogProps {
  folderLabel: string;
  itemCount: number;
  busy?: boolean;
  onConfirm: (threshold: DuplicateThreshold) => void;
  onCancel: () => void;
}

export function FindDuplicatesDialog({
  folderLabel,
  itemCount,
  busy = false,
  onConfirm,
  onCancel,
}: FindDuplicatesDialogProps) {
  const [threshold, setThreshold] = useState<DuplicateThreshold>("near");

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(threshold);
  }, [busy, onConfirm, threshold]);

  return (
    <Dialog
      title="Find duplicates?"
      description={
        <>
          Compare <strong>{itemCount}</strong> {itemCount === 1 ? "file" : "files"} in{" "}
          <strong>{folderLabel}</strong> and group the matches. Duplicates will be marked in the
          gallery.
        </>
      }
      panelClassName="find-duplicates-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Find duplicates"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <RadioTileGroup
        value={threshold}
        options={THRESHOLD_OPTIONS}
        label="How alike"
        name="find-duplicates-threshold"
        groupLabel="Duplicate threshold"
        disabled={busy}
        onChange={setThreshold}
      />
    </Dialog>
  );
}
