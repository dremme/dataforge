/** The adjusted preview as other overlays read it: a canvas over the whole frame, plus a signal. */
export interface AdjustedPicture {
  canvas: HTMLCanvasElement;
  /** What pure black becomes, so a blackout fill shows what the render will. */
  blackout: string;
  subscribe: (listener: () => void) => () => void;
}

export interface PublishedPicture extends AdjustedPicture {
  publish: () => void;
}

export function createAdjustedPicture(canvas: HTMLCanvasElement): PublishedPicture {
  const listeners = new Set<() => void>();
  return {
    canvas,
    blackout: "rgb(0, 0, 0)",
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish() {
      listeners.forEach((listener) => listener());
    },
  };
}
