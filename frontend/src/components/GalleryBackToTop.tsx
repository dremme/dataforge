import { iconArrowUp } from "../icons";
import { classNames } from "../utils/classNames";
import { Icon } from "./Icon";

interface GalleryBackToTopProps {
  visible: boolean;
  onClick: () => void;
}

export function GalleryBackToTop({ visible, onClick }: GalleryBackToTopProps) {
  return (
    <button
      type="button"
      className={classNames("gallery-back-to-top", visible && "gallery-back-to-top--visible")}
      onClick={onClick}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
    >
      <Icon icon={iconArrowUp} className="gallery-back-to-top__icon" />
    </button>
  );
}
