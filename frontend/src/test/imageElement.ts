/**
 * jsdom decodes nothing, so every `<img>` reports `naturalWidth` and `naturalHeight` as
 * `0` - and the image editor is gated on those being real, so its panel never becomes
 * reachable in a test. This defines them on the prototype and hands back a restore
 * function, the way `stubVideoElement` does for a `<video>`'s metadata.
 *
 * The restore is not optional: `vi.restoreAllMocks()` does not undo
 * `Object.defineProperty`, so a test that skips it leaks into the next file.
 */
export function stubImageElement({
  width = 1920,
  height = 1080,
}: { width?: number; height?: number } = {}): () => void {
  const image = HTMLImageElement.prototype as unknown as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();

  const define = (key: string, descriptor: PropertyDescriptor) => {
    saved.set(key, Object.getOwnPropertyDescriptor(image, key));
    Object.defineProperty(image, key, { configurable: true, ...descriptor });
  };

  define("naturalWidth", { get: () => width });
  define("naturalHeight", { get: () => height });

  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) {
        Object.defineProperty(image, key, descriptor);
      } else {
        delete image[key];
      }
    }
  };
}
