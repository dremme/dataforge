import { useRef, useState, type CSSProperties } from "react";
import { swapsAxes } from "@/features/gallery/lib/imageEdit";
import { classNames } from "@/shared/lib/classNames";
import { AdjustCanvas } from "./AdjustCanvas";
import { CropOverlay } from "./CropOverlay";
import { MaskOverlay } from "./MaskOverlay";
import type { AdjustedPicture } from "@/features/gallery/lib/adjustedPicture";
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
  const [picture, setPicture] = useState<AdjustedPicture | null>(null);
  const [covered, setCovered] = useState(false);

  const canvasStyle = {
    "--edit-rotate": `${edit.draft.rotate}deg`,
    "--edit-flip-x": edit.draft.mirrorH ? -1 : 1,
    "--edit-flip-y": edit.draft.mirrorV ? -1 : 1,
  } as CSSProperties;

  return (
    <div
      className={classNames(
        "image-edit-stage",
        swapsAxes(edit.draft.rotate) && "image-edit-stage--turned",
      )}
    >
      <div className="image-edit-stage__canvas" style={canvasStyle}>
        <img
          ref={imageRef}
          className={classNames(
            "image-edit-stage__img",
            // Hidden, not removed: it still sizes the stage and feeds the preview its pixels.
            covered && "image-edit-stage__img--covered",
          )}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => edit.handleLoad(event.currentTarget)}
        />
        <AdjustCanvas
          key={src}
          mediaRef={imageRef}
          sourceWidth={edit.sourceWidth}
          sourceHeight={edit.sourceHeight}
          crop={edit.draft.crop}
          scale={edit.draft.scale}
          controls={edit.adjust}
          onPictureChange={setPicture}
          onShowingChange={setCovered}
        />
        {edit.draft.masks.length > 0 && !edit.adjust.zoomed && (
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
            picture={picture}
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
