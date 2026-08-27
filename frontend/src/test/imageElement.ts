/** jsdom reports 0 size; restore is required as `restoreAllMocks` skips `defineProperty`. */
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
