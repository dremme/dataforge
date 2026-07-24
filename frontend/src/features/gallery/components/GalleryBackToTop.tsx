import { iconArrowUp } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

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
