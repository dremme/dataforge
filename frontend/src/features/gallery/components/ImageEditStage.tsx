import { useId, useRef, type CSSProperties } from "react";
import { swapsAxes } from "@/features/gallery/lib/imageEdit";
import { feColorMatrixValues, isColorIdentity } from "@/features/gallery/lib/color";
import { classNames } from "@/shared/lib/classNames";
import { CropOverlay } from "./CropOverlay";
import { MaskOverlay } from "./MaskOverlay";
import type { ImageEdit } from "@/features/gallery/hooks/useImageEdit";

interface ImageEditStageProps {
  edit: ImageEdit;
  src: string;
  alt: string;
  disabled: boolean;
}

/** Measures nothing: a rotated img lays out upright. __canvas must be absolute for the overlays. */
export function ImageEditStage({ edit, src, alt, disabled }: ImageEditStageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const filterId = useId().replace(/:/g, "");

  const colored = !isColorIdentity(edit.draft);
  const canvasStyle = {
    "--edit-rotate": `${edit.draft.rotate}deg`,
    "--edit-flip-x": edit.draft.mirrorH ? -1 : 1,
    "--edit-flip-y": edit.draft.mirrorV ? -1 : 1,
    // Consumed by the image and the mask fills alone, so the crop and mask chrome stay untinted.
    "--edit-color-filter": colored ? `url(#${filterId})` : "none",
  } as CSSProperties;

  return (
    <div
      className={classNames(
        "image-edit-stage",
        swapsAxes(edit.draft.rotate) && "image-edit-stage--turned",
      )}
    >
      {colored && (
        <svg className="image-edit-stage__filter" aria-hidden="true" focusable="false">
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={feColorMatrixValues(edit.draft)} />
          </filter>
        </svg>
      )}
      <div className="image-edit-stage__canvas" style={canvasStyle}>
        <img
          ref={imageRef}
          className="image-edit-stage__img"
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => edit.handleLoad(event.currentTarget)}
        />
        {edit.draft.masks.length > 0 && (
          <MaskOverlay
            mediaRef={imageRef}
            src={src}
            masks={edit.draft.masks}
            selectedId={edit.selectedMaskId}
            sourceWidth={edit.sourceWidth}
            sourceHeight={edit.sourceHeight}
            orientation={edit.orientation}
            disabled={disabled}
            interactive={edit.maskActive}
            onSelect={edit.selectMask}
            onChange={edit.setMaskRect}
            onRemove={edit.removeMask}
          />
        )}
        {edit.cropActive && (
          <CropOverlay
            mediaRef={imageRef}
            crop={edit.draft.crop}
            sourceWidth={edit.sourceWidth}
            sourceHeight={edit.sourceHeight}
            aspectRatio={edit.aspectRatio}
            orientation={edit.orientation}
            disabled={disabled}
            onCropChange={edit.setCrop}
          />
        )}
      </div>
    </div>
  );
}
