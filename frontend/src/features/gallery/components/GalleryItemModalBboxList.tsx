import { useId } from "react";
import type { CaptionBBox } from "@/shared/types";
import {
  bboxHeight,
  bboxLabel,
  bboxWidth,
  BBOX_COLORS,
  formatBBoxCoords,
} from "@/features/gallery/lib/bbox";
import { classNames } from "@/shared/lib/classNames";

interface GalleryItemModalBboxListProps {
  bboxes: CaptionBBox[];
  bboxesEditable: boolean;
  selectedBboxIndex: number | null;
  onSelectedBboxIndexChange: (index: number) => void;
}

export function GalleryItemModalBboxList({
  bboxes,
  bboxesEditable,
  selectedBboxIndex,
  onSelectedBboxIndexChange,
}: GalleryItemModalBboxListProps) {
  const titleId = useId();

  if (bboxes.length === 0) return null;

  return (
    <section className="gallery-item-modal__bboxes" aria-labelledby={titleId}>
      <h3 id={titleId} className="gallery-item-modal__bboxes-title">
        Bounding boxes
        <span className="gallery-item-modal__bboxes-count">{bboxes.length}</span>
      </h3>
      <ul className="gallery-item-modal__bboxes-list" data-scroll-lock-allow>
        {bboxes.map((bbox, bboxIndex) => {
          const color = BBOX_COLORS[bboxIndex % BBOX_COLORS.length];
          const title = bboxLabel(bbox, bboxIndex);
          const isSelected = bboxesEditable && selectedBboxIndex === bboxIndex;

          return (
            <li key={bboxIndex}>
              <button
                type="button"
                className={classNames(
                  "gallery-item-modal__bbox-item",
                  isSelected && "gallery-item-modal__bbox-item--selected",
                )}
                onClick={() => onSelectedBboxIndexChange(bboxIndex)}
                disabled={!bboxesEditable}
                aria-pressed={bboxesEditable ? isSelected : undefined}
              >
                <span
                  className="gallery-item-modal__bbox-swatch"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <div className="gallery-item-modal__bbox-text">
                  <span className="gallery-item-modal__bbox-label">{title}</span>
                  <span className="gallery-item-modal__bbox-meta">
                    {bbox.type && (
                      <span className="gallery-item-modal__bbox-type">{bbox.type}</span>
                    )}
                    <span className="gallery-item-modal__bbox-coords">
                      {formatBBoxCoords(bbox)}
                    </span>
                    <span className="gallery-item-modal__bbox-size">
                      {Math.round(bboxWidth(bbox)).toLocaleString()} ×{" "}
                      {Math.round(bboxHeight(bbox)).toLocaleString()} px
                    </span>
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
