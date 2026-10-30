import { memo, useRef, type CSSProperties, type MouseEvent } from "react";
import { formatAspectRatio } from "@/features/gallery/lib/aspectRatio";
import { largeCardShowsTags } from "@/features/gallery/lib/cardGeometry";
import { DEFAULT_CARD_OPTIONS } from "@/features/gallery/lib/cardOptions";
import { getCardCaptionDisplay, getCardModifierClass } from "@/features/gallery/lib/captionStatus";
import {
  iconAudioLines,
  iconCheck,
  iconFileImage,
  iconFiles,
  iconMessageDashed,
  iconMessageWarning,
  iconScanSquare,
  iconTriangleAlert,
  iconVideo,
} from "@/shared/icons";
import {
  isAudio,
  isEditableVideo,
  isGif,
  isMotion,
  isVideo,
} from "@/features/gallery/lib/itemKind";
import { useHoverVideoPreview } from "@/features/gallery/hooks/useHoverVideoPreview";
import { useWrappedCount } from "@/features/gallery/hooks/useWrappedCount";
import { selectionIntentFor } from "@/features/gallery/lib/selectionIntent";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { formatDurationSeconds, formatMegapixels } from "@/shared/lib/format";
import { CardBadge } from "./CardBadge";
import { GalleryCardActions } from "./GalleryCardActions";
import { GalleryCardMedia } from "./GalleryCardMedia";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

type GalleryCardMode = Exclude<GalleryDisplayMode, "list">;

interface GalleryCardProps {
  inspected?: boolean;
  item: GalleryItem;
  onSelect: (path: string) => void;
  displayMode?: GalleryCardMode;
  /** 0 hides the caption and its status pill. */
  captionLines?: number;
  showMegapixels?: boolean;
  /** Adds the aspect ratio beside the megapixels. */
  showAspectRatio?: boolean;
  /** Large cards only: the strongest tags in one row at the bottom. */
  showTags?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (path: string) => void;
  onExtendSelect?: (path: string) => void;
  /** Quick actions over the media; both must be stable, since the card is memoized. */
  onCopyCaption?: (caption: string) => void;
  onDelete?: (path: string) => void;
}

export const GalleryCard = memo(function GalleryCard({
  inspected = false,
  item,
  onSelect,
  displayMode = "large",
  captionLines = displayMode === "small"
    ? DEFAULT_CARD_OPTIONS.smallCaptionLines
    : DEFAULT_CARD_OPTIONS.largeCaptionLines,
  showMegapixels = true,
  showAspectRatio = false,
  showTags = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onExtendSelect,
  onCopyCaption,
  onDelete,
}: GalleryCardProps) {
  const captionDisplay = getCardCaptionDisplay(item);
  const statusIcon = captionDisplay?.variant === "warning" ? iconTriangleAlert : iconMessageDashed;
  const itemIsVideo = isVideo(item);
  const itemIsGif = isGif(item);
  const itemIsAudio = isAudio(item);
  // The editable set is exactly what a <video> element can decode.
  const { previewing, hoverHandlers } = useHoverVideoPreview(isEditableVideo(item));
  const tagsShown = displayMode === "large" && largeCardShowsTags(item, showTags);
  const tagListRef = useRef<HTMLSpanElement>(null);
  const hiddenTags = useWrappedCount(tagListRef, tagsShown ? item.tags : null);

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
  const mediaLength = formatDurationSeconds(item.duration);
  const meta =
    item.width && item.height
      ? [
          showMegapixels && formatMegapixels(item.width, item.height),
          showAspectRatio && formatAspectRatio(item.width, item.height),
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <div className="card-cell">
      <Tooltip content={item.name} className="card-cell__tip">
        <button
          data-inspected={inspected || undefined}
          type="button"
          className={classNames(
            "card",
            `card--${displayMode}`,
            getCardModifierClass(item),
            isMotion(item) && "card--video",
            selected && "card--selected",
          )}
          {...hoverHandlers}
          onClick={handleClick}
          onDragStart={(event) => event.preventDefault()}
          aria-label={
            selectionMode ? `${selected ? "Deselect" : "Select"} ${item.name}` : `View ${item.name}`
          }
          aria-pressed={selectionMode ? selected : undefined}
        >
          <div
            className={classNames(
              "card__media",
              displayMode === "large" &&
                (item.width ?? 0) > 0 &&
                (item.height ?? 0) > 0 &&
                "card__media--fitted",
            )}
          >
            <GalleryCardMedia item={item} previewing={previewing} />
            {selectionMode && (
              <span className="card__selection-indicator" aria-hidden="true">
                {selected && <Icon icon={iconCheck} className="card__selection-indicator-icon" />}
              </span>
            )}
            {itemIsVideo && (
              <CardBadge
                icon={iconVideo}
                compact={compactBadges}
                label={mediaLength || "Video"}
                variant="video"
                numeric={!!mediaLength}
              />
            )}
            {itemIsAudio && (
              <CardBadge
                icon={iconAudioLines}
                compact={compactBadges}
                label={mediaLength || "Audio"}
                variant="audio"
                numeric={!!mediaLength}
              />
            )}
            {itemIsGif && (
              <CardBadge icon={iconFileImage} compact={compactBadges} label="GIF" variant="gif" />
            )}
            {(item.has_issue_file || item.has_candidate || item.has_duplicate_file) && (
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
                {item.has_duplicate_file && (
                  <CardBadge
                    icon={iconFiles}
                    compact={compactBadges}
                    label="Duplicate"
                    variant="duplicate"
                  />
                )}
              </span>
            )}
          </div>
          <div className="card__body">
            <span className="card__head">
              <span className="card__title">{item.name}</span>
              {meta && <span className="card__meta">{meta}</span>}
            </span>
            {tagsShown && (
              <span className="card__tags">
                {/* Every tag, strongest first: the ones that do not fit wrap out of sight. */}
                <span ref={tagListRef} className="card__tag-list">
                  {item.tags.map((tag) => (
                    <span key={tag.label} className="card__tag">
                      {tag.label}
                    </span>
                  ))}
                </span>
                {hiddenTags > 0 && (
                  <Tooltip
                    content={item.tags
                      .slice(item.tags.length - hiddenTags)
                      .map((tag) => tag.label)
                      .join(", ")}
                    placement="top"
                    className="card__tags-more-tip"
                  >
                    <span className="card__tags-more">+{hiddenTags} more</span>
                  </Tooltip>
                )}
              </span>
            )}
            {captionLines === 0 ? null : item.description ? (
              <p
                className="card__description"
                style={{ "--card-caption-lines": captionLines } as CSSProperties}
              >
                {item.description}
              </p>
            ) : captionDisplay ? (
              <div
                className={`card__caption-status card__caption-status--${captionDisplay.variant}`}
              >
                <Icon icon={statusIcon} className="card__caption-status__icon" />
                <span>{captionDisplay.message}</span>
              </div>
            ) : null}
          </div>
        </button>
      </Tooltip>
      <GalleryCardActions
        name={item.name}
        path={item.path}
        caption={item.description}
        displayMode={displayMode}
        selectionMode={selectionMode}
        onOpen={onSelect}
        onCopyCaption={onCopyCaption}
        onDelete={onDelete}
      />
    </div>
  );
});
