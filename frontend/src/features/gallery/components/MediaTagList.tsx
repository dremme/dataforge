import { useRef } from "react";
import { useWrappedCount } from "@/features/gallery/hooks/useWrappedCount";
import type { MediaTag } from "@/shared/types";
import { Tooltip } from "@/shared/ui/Tooltip";

interface MediaTagListProps {
  tags: readonly MediaTag[];
}

function percent(confidence: number): number {
  return Math.round(confidence * 100);
}

/**
 * One row, always rendered: the paging dialog reserves its height, so it shows the strongest
 * tags that fit and counts the rest, and a file with none keeps the row. Hidden tags stay
 * readable to assistive tech, so the count is for sighted readers only.
 */
export function MediaTagList({ tags }: MediaTagListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const hidden = useWrappedCount(listRef, tags);

  const hiddenLabels = tags.slice(tags.length - hidden).map((tag) => tag.label);

  return (
    <div className="media-tags" role="group" aria-label="Tags">
      <span className="media-tags__label">Tags</span>
      {tags.length === 0 ? (
        <span className="media-tags__empty">None. Only favorite folders are tagged.</span>
      ) : (
        <>
          <ul ref={listRef} className="media-tags__list">
            {tags.map((tag) => (
              <li
                key={tag.label}
                className="media-tags__tag"
                title={`${percent(tag.confidence)}% confidence`}
              >
                {tag.label}
                <span className="media-tags__score">{percent(tag.confidence)}%</span>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            // Above: the row is the lowest thing in the panel, so a bubble below would be cut.
            <Tooltip
              content={hiddenLabels.join(", ")}
              placement="top"
              className="media-tags__more-tip"
            >
              <span className="media-tags__more" aria-hidden="true">
                +{hidden} more
              </span>
            </Tooltip>
          )}
        </>
      )}
    </div>
  );
}
