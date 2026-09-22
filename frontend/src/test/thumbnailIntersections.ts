import { onTestFinished } from "vitest";
import { isElementInGalleryLoadZone } from "@/features/gallery/lib/scrollRoot";

export function installThumbnailIntersections() {
  const Original = window.IntersectionObserver;
  onTestFinished(() => {
    window.IntersectionObserver = Original;
  });
  const observers = new Set<{ sync: () => void; targets: Map<Element, boolean | undefined> }>();
  window.IntersectionObserver = class extends Original {
    readonly targets = new Map<Element, boolean | undefined>();
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super(callback, options);
      this.sync = () => {
        for (const [target, previous] of this.targets) {
          const isIntersecting = isElementInGalleryLoadZone(
            target,
            options?.root instanceof Element ? options.root : null,
            Number.parseFloat(options?.rootMargin ?? "0"),
          );
          if (isIntersecting === previous) continue;
          this.targets.set(target, isIntersecting);
          callback([{ target, isIntersecting } as IntersectionObserverEntry], this);
        }
      };
      observers.add(this);
    }
    sync = () => {};
    observe(target: Element) {
      this.targets.set(target, undefined);
      this.sync();
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  };
  return {
    sync: () => observers.forEach((observer) => observer.sync()),
    count: () => observers.size,
    targets: () => [...observers].reduce((count, observer) => count + observer.targets.size, 0),
  };
}
