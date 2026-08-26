import { memo, type MouseEvent } from "react";
import { getCardCaptionDisplay, getCardModifierClass } from "@/features/gallery/lib/captionStatus";
import {
  iconCheck,
  iconExpand,
  iconFileImage,
  iconFiles,
  iconMessageDashed,
  iconMessageWarning,
  iconPlay,
  iconScanSquare,
  iconTriangleAlert,
  iconVideo,
} from "@/shared/icons";
import { isGif, isMotion, isVideo } from "@/features/gallery/lib/itemKind";
import { selectionIntentFor } from "@/features/gallery/lib/selectionIntent";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { CardBadge } from "./CardBadge";
import { GalleryCardMedia } from "./GalleryCardMedia";
import { Icon } from "@/shared/ui/Icon";

/** List mode has no card; it renders `GalleryListRow` instead. */
type GalleryCardMode = Exclude<GalleryDisplayMode, "list">;

interface GalleryCardProps {
  item: GalleryItem;
  onSelect: (path: string) => void;
  displayMode?: GalleryCardMode;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (path: string) => void;
  /** Shift+click: extend the selection from the last-clicked item to this one. */
  onExtendSelect?: (path: string) => void;
}

/**
 * Memoized: the grid is virtualized and re-renders on every selection change,
 * but an individual card only changes when its own `selected` flag flips.
 */
export const GalleryCard = memo(function GalleryCard({
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
  // The overlay asks whether the card opens a player, which a GIF does not; the
  // card modifier and badge ask what the file is.
  const itemIsVideo = isVideo(item);
  const itemIsGif = isGif(item);

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

  return (
    <button
      type="button"
      className={classNames(
        "card",
        `card--${displayMode}`,
        getCardModifierClass(item),
        isMotion(item) && "card--video",
        selected && "card--selected",
      )}
      onClick={handleClick}
      onDragStart={(event) => event.preventDefault()}
      aria-label={
        selectionMode ? `${selected ? "Deselect" : "Select"} ${item.name}` : `View ${item.name}`
      }
      aria-pressed={selectionMode ? selected : undefined}
    >
      <div className="card__media">
        <GalleryCardMedia item={item} />
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
            <Icon icon={itemIsVideo ? iconPlay : iconExpand} className="card__view-icon" />
            {itemIsVideo ? "Play" : "View"}
          </span>
        </span>
        {itemIsVideo && <CardBadge icon={iconVideo} label="Video" variant="video" />}
        {itemIsGif && <CardBadge icon={iconFileImage} label="GIF" variant="gif" />}
        {item.has_issue_file && (
          <CardBadge icon={iconMessageWarning} label="Issue" variant="issue" />
        )}
        {item.has_duplicate_file && (
          <CardBadge icon={iconFiles} label="Duplicate" variant="duplicate" />
        )}
        {item.has_candidate && (
          <CardBadge icon={iconScanSquare} label="Candidate" variant="candidate" />
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
