import { useRef, type CSSProperties } from "react";
import { swapsAxes } from "@/features/gallery/lib/imageEdit";
import { classNames } from "@/shared/lib/classNames";
import { CropOverlay } from "./CropOverlay";
import type { ImageEdit } from "@/features/gallery/hooks/useImageEdit";

interface ImageEditStageProps {
  edit: ImageEdit;
  src: string;
  alt: string;
  disabled: boolean;
}

/** Measures nothing: a rotated img lays out upright. __canvas must be absolute for CropOverlay. */
export function ImageEditStage({ edit, src, alt, disabled }: ImageEditStageProps) {
  const imageRef = useRef<HTMLImageElement>(null);

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
          className="image-edit-stage__img"
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => edit.handleLoad(event.currentTarget)}
        />
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
