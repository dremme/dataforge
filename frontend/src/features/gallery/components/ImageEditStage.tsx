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

/**
 * The image, turned the way the draft says, with the crop rectangle riding on top of it.
 *
 * Its own component rather than a mode on `ZoomableImage`: editing wants no zoom
 * transform competing with the rotation, and the rotation needs a container of its own to
 * live on.
 *
 * Deliberately measures nothing. A rotated `<img>` still lays out upright, so sizing it
 * from the box it is sitting in means sizing it from a box it has already inflated -
 * `_image-edit-stage.scss` fixes that box instead, and all this has to say is which way
 * the picture faces. The one thing that must be got right here is that `__canvas` carries
 * `position: absolute` as well as the transform: a transformed element is already the
 * containing block for an absolutely positioned descendant, but `offsetParent` skips it
 * unless it is positioned too - and `CropOverlay` measures through `offsetParent`.
 */
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
