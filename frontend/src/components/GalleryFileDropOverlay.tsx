import { iconFileDown } from "../icons";
import { Icon } from "./Icon";

type GalleryFileDropOverlayProps = {
  visible: boolean;
  folderLabel: string;
};

export function GalleryFileDropOverlay({ visible, folderLabel }: GalleryFileDropOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="gallery-drop-overlay" aria-hidden="true">
      <div className="gallery-drop-overlay__panel">
        <Icon icon={iconFileDown} className="gallery-drop-overlay__icon" />
        <p className="gallery-drop-overlay__title">Drop files to import</p>
        <p className="gallery-drop-overlay__description">
          Compatible images, videos, .txt/.json captions, and .sysprompt files will be imported into{" "}
          <span className="gallery-drop-overlay__folder">{folderLabel}</span>.
        </p>
      </div>
    </div>
  );
}
