import { JPEG_QUALITY } from "@/features/gallery/lib/frameCapture";

const SEEK_TIMEOUT_MS = 2500;
const PRESENT_TIMEOUT_MS = 150;
const SETTLED_EPSILON = 0.001;

/**
 * seeked fires before the compositor has the frame, and requestVideoFrameCallback is
 * unreliable on a paused element, so the timeout is required or a save hangs.
 */
function awaitPresentedFrame(video: HTMLVideoElement): Promise<number> {
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
