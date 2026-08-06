import { JPEG_QUALITY } from "@/features/gallery/lib/frameCapture";

/** A seek that never reports back must fail loudly rather than hang the save button. */
const SEEK_TIMEOUT_MS = 2500;

/** How long to wait for the decoder to present the seeked frame before drawing anyway. */
const PRESENT_TIMEOUT_MS = 150;

/** Below this the element is already where we want it, so no seek is issued. */
const SETTLED_EPSILON = 0.001;

/**
 * Waits for the decoder to actually present the frame, resolving its true media time.
 *
 * `seeked` fires when the seek completes, not when the new frame reaches the
 * compositor, so drawing straight after it can capture the previous frame. The
 * timeout is not optional: `requestVideoFrameCallback` does not reliably fire on a
 * paused element in every engine, and without the race a save would hang silently.
 */
function awaitPresentedFrame(video: HTMLVideoElement): Promise<number> {
  // Declared in the DOM lib but not implemented everywhere (Safari, jsdom), so the
  // support check has to happen at runtime rather than in the type.
  if (typeof video.requestVideoFrameCallback !== "function") {
    return Promise.resolve(video.currentTime);
  }

  return new Promise((resolve) => {
    let settled = false;

    const handle = video.requestVideoFrameCallback((_now, metadata) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(metadata.mediaTime);
    });

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      video.cancelVideoFrameCallback(handle);
      resolve(video.currentTime);
    }, PRESENT_TIMEOUT_MS);
  });
}

/**
 * Seeks the element to `time` and resolves the media time actually presented.
 *
 * The slider writes `currentTime` on every input, so at save time the element is
 * usually already there — but a seek may still be in flight, which `seeking` catches.
 */
export function seekVideoTo(video: HTMLVideoElement, time: number): Promise<number> {
  if (!video.seeking && Math.abs(video.currentTime - time) <= SETTLED_EPSILON) {
    return awaitPresentedFrame(video);
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("The video could not seek to that position."));
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("The video did not seek in time."));
    }, SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  }).then(() => awaitPresentedFrame(video));
}

/**
 * Draws the element's current frame at its native resolution and encodes it as JPEG.
 *
 * The canvas is allocated per call rather than held in a ref: a 4K backing store is
 * tens of megabytes to retain for a button pressed occasionally, and the allocation
 * disappears next to the upload.
 */
export function encodeVideoFrame(
  video: HTMLVideoElement,
  quality: number = JPEG_QUALITY,
): Promise<Blob> {
  const { videoWidth: width, videoHeight: height } = video;

  if (width <= 0 || height <= 0) {
    return Promise.reject(new Error("The video has no decoded frame yet."));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.reject(new Error("This browser cannot draw the video frame."));
  }

  context.drawImage(video, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("The frame could not be encoded as JPEG."));
      },
      "image/jpeg",
      quality,
    );
  });
}
