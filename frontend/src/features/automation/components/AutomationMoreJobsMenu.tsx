import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  iconChevronDown,
  iconGroup,
  iconLoader2,
  iconFilePen,
  iconMessageCheck,
  iconMessagePlus,
  iconShredder,
  type AppIcon,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface MoreJobOption {
  id: "body_parts" | "strip_metadata" | "set_captions" | "verify_captions" | "batch_rename";
  label: string;
  description: string;
  icon: AppIcon;
  starting: boolean;
  onSelect: () => void;
}

interface AutomationMoreJobsMenuProps {
  disabled: boolean;
  startingBodyParts: boolean;
  startingStripMetadata: boolean;
  startingSetCaptions: boolean;
  startingVerifyCaptions: boolean;
  startingBatchRename: boolean;
  onStartBodyParts: () => void;
  onStartStripMetadata: () => void;
  onStartSetCaptions: () => void;
  onStartVerifyCaptions: () => void;
  onStartBatchRename: () => void;
}

export function AutomationMoreJobsMenu({
  disabled,
  startingBodyParts,
  startingStripMetadata,
  startingSetCaptions,
  startingVerifyCaptions,
  startingBatchRename,
  onStartBodyParts,
  onStartStripMetadata,
  onStartSetCaptions,
  onStartVerifyCaptions,
  onStartBatchRename,
}: AutomationMoreJobsMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const secondaryStarting =
    startingBodyParts ||
    startingStripMetadata ||
    startingSetCaptions ||
    startingVerifyCaptions ||
    startingBatchRename;

  const close = useCallback(() => setOpen(false), []);

  const jobs: MoreJobOption[] = [
    {
      id: "body_parts",
      label: "Detect body parts",
      description: "Detect body and face; optional SAM keywords.",
      icon: iconGroup,
      starting: startingBodyParts,
      onSelect: onStartBodyParts,
    },
    {
      id: "strip_metadata",
      label: "Strip metadata",
      description: "Remove embedded metadata from media files.",
      icon: iconShredder,
      starting: startingStripMetadata,
      onSelect: onStartStripMetadata,
    },
    {
      id: "batch_rename",
      label: "Batch rename",
      description: "Rename media files.",
      icon: iconFilePen,
      starting: startingBatchRename,
      onSelect: onStartBatchRename,
    },
    {
      id: "set_captions",
      label: "Set captions",
      description: "Write the same caption text to media files.",
      icon: iconMessagePlus,
      starting: startingSetCaptions,
      onSelect: onStartSetCaptions,
    },
    {
      id: "verify_captions",
      label: "Verify captions",
      description: "Verifies captions by comparing them with their media file.",
      icon: iconMessageCheck,
      starting: startingVerifyCaptions,
      onSelect: onStartVerifyCaptions,
    },
  ];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  const handleSelect = (job: MoreJobOption) => {
    if (disabled || job.starting) return;
    close();
    job.onSelect();
  };

  return (
    <div ref={rootRef} className={`automation__more${open ? " automation__more--open" : ""}`}>
      <button
        type="button"
        className="automation__more-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {secondaryStarting ? (
          <Icon icon={iconLoader2} className="automation__btn-icon automation__btn-icon--spin" />
        ) : null}
        More jobs
        {!secondaryStarting && (
          <Icon icon={iconChevronDown} className="automation__more-trigger-chevron" />
        )}
      </button>

      {open && (
        <div id={menuId} className="automation__more-menu" role="menu" aria-label="More jobs">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              role="menuitem"
              className="automation__more-item"
              onClick={() => handleSelect(job)}
              disabled={disabled || job.starting}
            >
              <Icon icon={job.icon} className="automation__more-item-icon" />
              <span className="automation__more-item-text">
                <span className="automation__more-item-title">{job.label}</span>
                <span className="automation__more-item-desc">{job.description}</span>
              </span>
              {job.starting && (
                <Icon
                  icon={iconLoader2}
                  className="automation__more-item-spinner automation__btn-icon--spin"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
