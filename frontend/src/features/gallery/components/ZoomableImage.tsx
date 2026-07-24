import type { ImgHTMLAttributes, ReactNode, SyntheticEvent } from "react";
import { useCallback, useRef } from "react";
import { useImageZoom } from "@/features/gallery/hooks/useImageZoom";
import { classNames } from "@/shared/lib/classNames";

interface ZoomableImageProps {
  src: string;
  alt: string;
  imgClassName?: string;
  className?: string;
  zoomable?: boolean;
  onLoad?: ImgHTMLAttributes<HTMLImageElement>["onLoad"];
  children?: ReactNode;
}

export function ZoomableImage({
  src,
  alt,
  imgClassName,
  className,
  zoomable = true,
  onLoad,
  children,
}: ZoomableImageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    zoomed,
    containerStyle,
    canvasStyle,
    handleClick,
    handleMouseMove,
    toggleZoom,
    recordNaturalSize,
  } = useImageZoom(src, zoomable);

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      recordNaturalSize(img.naturalWidth, img.naturalHeight);
      onLoad?.(event);
    },
    [onLoad, recordNaturalSize],
  );

  if (!zoomable) {
    return (
      <div className={classNames("zoomable-image", "zoomable-image--static", className)}>
        <div className="zoomable-image__canvas">
          <img
            className={classNames("zoomable-image__img", imgClassName)}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={handleLoad}
          />
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={classNames("zoomable-image", zoomed && "zoomable-image--zoomed", className)}
      style={containerStyle}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      role="button"
      tabIndex={0}
      aria-label={zoomed ? `Zoom out ${alt}` : `Zoom in ${alt}`}
      aria-pressed={zoomed}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleZoom(rootRef.current);
      }}
    >
      <div className="zoomable-image__canvas" style={canvasStyle}>
        <img
          className={classNames("zoomable-image__img", imgClassName)}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={handleLoad}
        />
        {children}
      </div>
    </div>
  );
}
