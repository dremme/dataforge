import { vi } from "vitest";

export function installThumbnailImages() {
  const images: HTMLImageElement[] = [];
  vi.spyOn(globalThis, "Image").mockImplementation(function () {
    const image = document.createElement("img");
    images.push(image);
    return image;
  });
  return {
    images,
    load: (index = images.length - 1) => images[index].dispatchEvent(new Event("load")),
    fail: (index = images.length - 1) => images[index].dispatchEvent(new Event("error")),
  };
}
