import { iconFolderTree, iconImages } from "../icons";
import { SectionHeader } from "./SectionHeader";

const FOLDER_SKELETON_COUNT = 3;
const GALLERY_SKELETON_COUNT = 6;

export function FolderBrowseLoading() {
  return (
    <div
      className="browse-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading folder contents"
      aria-busy="true"
    >
      <section className="folder-section folder-section--loading">
        <SectionHeader section="folder" icon={iconFolderTree} title="Folders" count={0} loading />
        <div className="folder-grid folder-grid--skeleton">
          {Array.from({ length: FOLDER_SKELETON_COUNT }, (_, index) => (
            <div
              key={index}
              className="folder-card folder-card--skeleton"
              style={{ animationDelay: `${index * 0.07}s` }}
              aria-hidden="true"
            >
              <span className="folder-card__icon folder-card__skeleton-block skeleton-shimmer" />
              <span className="folder-card__body">
                <span className="folder-card__skeleton-line skeleton-shimmer" />
                <span className="folder-card__skeleton-line folder-card__skeleton-line--short skeleton-shimmer" />
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="gallery-section gallery-section--loading">
        <SectionHeader section="gallery" icon={iconImages} title="Media" count={0} loading />
        <div className="gallery gallery--skeleton">
          {Array.from({ length: GALLERY_SKELETON_COUNT }, (_, index) => (
            <article
              key={index}
              className="card card--skeleton"
              style={{ animationDelay: `${index * 0.05}s` }}
              aria-hidden="true"
            >
              <div className="card__media-skeleton skeleton-shimmer" />
              <div className="card__body">
                <span className="card__skeleton-line skeleton-shimmer" />
                <span className="card__skeleton-line card__skeleton-line--short skeleton-shimmer" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
