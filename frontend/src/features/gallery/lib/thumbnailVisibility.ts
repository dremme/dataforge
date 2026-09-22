import {
  GALLERY_MEDIA_KEEP_MARGIN_PX,
  GALLERY_MEDIA_LOAD_MARGIN_PX,
  getGalleryMediaZones,
} from "./scrollRoot";
import type { GalleryMediaZones } from "./scrollRoot";

interface ObserverGroup {
  observers: IntersectionObserver[];
  targets: Map<Element, (hint?: boolean) => void>;
}

export class ThumbnailVisibility {
  private groups = new Map<Element | null, ObserverGroup>();
  private frames = new Set<number>();

  observe(
    element: Element,
    root: Element | null,
    listener: (zones: GalleryMediaZones) => void,
  ): () => void {
    let group = this.groups.get(root);
    if (!group) {
      const targets: ObserverGroup["targets"] = new Map();
      const observers = [0, GALLERY_MEDIA_LOAD_MARGIN_PX, GALLERY_MEDIA_KEEP_MARGIN_PX].map(
        (margin) =>
          new IntersectionObserver(
            (entries) => {
              for (const entry of entries) targets.get(entry.target)?.(entry.isIntersecting);
            },
            { root, rootMargin: `${margin}px 0px`, threshold: 0 },
          ),
      );
      group = { targets, observers };
      this.groups.set(root, group);
    }
    let previous: GalleryMediaZones | undefined;
    const sync = (hint?: boolean) => {
      const next = getGalleryMediaZones(element, root, hint);
      if (
        previous?.priority === next.priority &&
        previous.shouldLoad === next.shouldLoad &&
        previous.shouldKeep === next.shouldKeep
      )
        return;
      previous = next;
      listener(next);
    };
    group.targets.set(element, sync);
    sync();
    group.observers.forEach((observer) => observer.observe(element));
    const frame = requestAnimationFrame(() => {
      this.frames.delete(frame);
      sync();
    });
    this.frames.add(frame);
    return () => {
      cancelAnimationFrame(frame);
      this.frames.delete(frame);
      group.targets.delete(element);
      group.observers.forEach((observer) => observer.unobserve(element));
      if (!group.targets.size) {
        group.observers.forEach((observer) => observer.disconnect());
        if (this.groups.get(root) === group) this.groups.delete(root);
      }
    };
  }

  dispose(): void {
    for (const frame of this.frames) cancelAnimationFrame(frame);
    this.frames.clear();
    for (const group of this.groups.values()) {
      group.observers.forEach((observer) => observer.disconnect());
      group.targets.clear();
    }
    this.groups.clear();
  }
}
