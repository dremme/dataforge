import type { ImgHTMLAttributes, ReactNode } from "react";
import { useRef } from "react";
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
  const { zoomed, canvasStyle, handleClick, handleMouseMove, toggleZoom } = useImageZoom(
    src,
    zoomable,
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
            onLoad={onLoad}
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
          onLoad={onLoad}
        />
        {children}
      </div>
    </div>
  );
}
