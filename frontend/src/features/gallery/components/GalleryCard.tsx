import { memo, useState, type MouseEvent } from "react";
import { getCardCaptionDisplay, getCardModifierClass } from "@/features/gallery/lib/captionStatus";
import {
  iconCheck,
  iconExpand,
  iconFileImage,
  iconFiles,
  iconMessageDashed,
  iconMessageWarning,
  iconScanSquare,
  iconTriangleAlert,
  iconVideo,
} from "@/shared/icons";
import { isEditableVideo, isGif, isMotion, isVideo } from "@/features/gallery/lib/itemKind";
import { useHoverVideoPreview } from "@/features/gallery/hooks/useHoverVideoPreview";
import { selectionIntentFor } from "@/features/gallery/lib/selectionIntent";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { CardBadge } from "./CardBadge";
import { GalleryCardMedia } from "./GalleryCardMedia";
import { Icon } from "@/shared/ui/Icon";

type GalleryCardMode = Exclude<GalleryDisplayMode, "list">;

interface GalleryCardProps {
  inspected?: boolean;
  item: GalleryItem;
  onSelect: (path: string) => void;
  displayMode?: GalleryCardMode;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (path: string) => void;
  onExtendSelect?: (path: string) => void;
}

export const GalleryCard = memo(function GalleryCard({
  inspected = false,
  item,
  onSelect,
  displayMode = "large",
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onExtendSelect,
}: GalleryCardProps) {
  const captionDisplay = getCardCaptionDisplay(item);
  const statusIcon = captionDisplay?.variant === "warning" ? iconTriangleAlert : iconMessageDashed;
  const itemIsVideo = isVideo(item);
  const itemIsGif = isGif(item);
  // The editable set is exactly what a <video> element can decode.
  const { previewing, hoverHandlers } = useHoverVideoPreview(isEditableVideo(item));
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const intent = selectionIntentFor(event, selectionMode);

    if (intent === "range" && onExtendSelect) {
      onExtendSelect(item.path);
      return;
    }
    if (intent !== "open" && onToggleSelect) {
      onToggleSelect(item.path);
      return;
    }
    onSelect(item.path);
  };

  const compactBadges = displayMode === "small";

  return (
    <button
      data-inspected={inspected || undefined}
      type="button"
      className={classNames(
        "card",
        `card--${displayMode}`,
        getCardModifierClass(item),
        isMotion(item) && "card--video",
        selected && "card--selected",
        previewPlaying && "card--previewing",
      )}
      {...hoverHandlers}
      onClick={handleClick}
      onDragStart={(event) => event.preventDefault()}
      aria-label={
        selectionMode ? `${selected ? "Deselect" : "Select"} ${item.name}` : `View ${item.name}`
      }
      aria-pressed={selectionMode ? selected : undefined}
    >
      <div className="card__media">
        <GalleryCardMedia
          item={item}
          previewing={previewing}
          onPreviewPlaying={setPreviewPlaying}
        />
        {selectionMode && (
          <span className="card__selection-indicator" aria-hidden="true">
            {selected && <Icon icon={iconCheck} className="card__selection-indicator-icon" />}
          </span>
        )}
        <span
          className={classNames("card__overlay", selectionMode && "card__overlay--hidden")}
          aria-hidden="true"
        >
          <span className="card__view">
            <Icon icon={iconExpand} className="card__view-icon" />
            Open
          </span>
        </span>
        {itemIsVideo && (
          <CardBadge icon={iconVideo} compact={compactBadges} label="Video" variant="video" />
        )}
        {itemIsGif && (
          <CardBadge icon={iconFileImage} compact={compactBadges} label="GIF" variant="gif" />
        )}
        {(item.has_issue_file || item.has_candidate) && (
          <span className="card__badge-stack">
            {item.has_issue_file && (
              <CardBadge
                icon={iconMessageWarning}
                compact={compactBadges}
                label="Issue"
                variant="issue"
              />
            )}
            {item.has_candidate && (
              <CardBadge
                icon={iconScanSquare}
                compact={compactBadges}
                label="Candidate"
                variant="candidate"
              />
            )}
          </span>
        )}
        {item.has_duplicate_file && (
          <CardBadge
            icon={iconFiles}
            compact={compactBadges}
            label="Duplicate"
            variant="duplicate"
          />
        )}
      </div>
      <div className="card__body">
        <span className="card__title" title={item.name}>
          {item.name}
        </span>
        {item.description ? (
          <p className="card__description">{item.description}</p>
        ) : captionDisplay ? (
          <div className={`card__caption-status card__caption-status--${captionDisplay.variant}`}>
            <Icon icon={statusIcon} className="card__caption-status__icon" />
            <span>{captionDisplay.message}</span>
          </div>
        ) : null}
      </div>
    </button>
  );
});
