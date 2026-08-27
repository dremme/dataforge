/** jsdom reports `NaN` duration; restore is needed as `restoreAllMocks` skips `defineProperty`. */
export function stubVideoElement({
  duration = 12,
  width = 1920,
  height = 1080,
}: { duration?: number; width?: number; height?: number } = {}): () => void {
  const media = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  const video = HTMLVideoElement.prototype as unknown as Record<string, unknown>;

  const originals = new Map<Record<string, unknown>, Map<string, PropertyDescriptor | undefined>>([
    [media, new Map()],
    [video, new Map()],
  ]);

  const define = (target: Record<string, unknown>, key: string, descriptor: PropertyDescriptor) => {
    originals.get(target)?.set(key, Object.getOwnPropertyDescriptor(target, key));
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
  };

  define(media, "duration", { get: () => duration });
  define(media, "pause", { writable: true, value: function pause() {} });
  define(video, "videoWidth", { get: () => width });
  define(video, "videoHeight", { get: () => height });

  return () => {
    for (const [target, saved] of originals) {
      for (const [key, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(target, key, descriptor);
        } else {
          delete target[key];
        }
      }
    }
  };
}
