import { useLayoutEffect, useState } from "react";
import { iconFileDown } from "@/shared/icons";
import { getAppScrollElement } from "@/shared/lib/appScroll";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { Icon } from "@/shared/ui/Icon";

type GalleryFileDropOverlayProps = {
  visible: boolean;
  folderLabel: string;
};

function useScrollPortHeight(enabled: boolean): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const scrollRoot = getAppScrollElement();
    if (!scrollRoot) {
      return;
    }

    const update = () => {
      setHeight(scrollRoot.clientHeight);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [enabled]);

  return height;
}

export function GalleryFileDropOverlay({ visible, folderLabel }: GalleryFileDropOverlayProps) {
  const scrollPortHeight = useScrollPortHeight(visible);

  if (!visible) {
    return null;
  }

  return (
    <div className="gallery-drop-overlay" aria-hidden="true">
      <div
        className="gallery-drop-overlay__viewport"
        style={
          scrollPortHeight && scrollPortHeight > 0 ? { height: `${scrollPortHeight}px` } : undefined
        }
      >
        <div className="gallery-drop-overlay__panel">
          <Icon icon={iconFileDown} className="gallery-drop-overlay__icon" />
          <p className="gallery-drop-overlay__title">Drop files to import</p>
          <p className="gallery-drop-overlay__description">
            Compatible images, videos, {CAPTION_SIDECAR_EXTENSION_LIST} captions, and .sysprompt
            files will be imported into{" "}
            <span className="gallery-drop-overlay__folder">{folderLabel}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
