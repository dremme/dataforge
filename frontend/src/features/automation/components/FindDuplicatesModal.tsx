import { useCallback, useState } from "react";
import type { DuplicateThreshold } from "@/shared/types";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";

const THRESHOLD_OPTIONS: ReadonlyArray<RadioTileOption<DuplicateThreshold>> = [
  { value: "exact", title: "Exact", description: "Only files that look identical." },
  { value: "near", title: "Near", description: "Crops, re-encodes, and small edits." },
  { value: "loose", title: "Loose", description: "Anything similar. Expect false matches." },
];

interface FindDuplicatesModalProps {
  scope: ModalScopeInfo;
  initialSettings: JobSettingsByType["find_duplicates"];
  busy?: boolean;
  onConfirm: (threshold: DuplicateThreshold) => void;
  onCancel: () => void;
}

export function FindDuplicatesModal({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: FindDuplicatesModalProps) {
  const [threshold, setThreshold] = useState<DuplicateThreshold>(initialSettings.threshold);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(threshold);
  }, [busy, onConfirm, threshold]);

  return (
    <Modal
      scope={scope}
      title="Find duplicates?"
      description={
        <>Compares them and groups the matches. Duplicates will be marked in the gallery.</>
      }
      panelClassName="find-duplicates-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <ModalActions
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
    </Modal>
  );
}
