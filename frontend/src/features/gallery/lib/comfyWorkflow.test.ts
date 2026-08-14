import { describe, expect, it } from "vitest";
import { supportsComfyWorkflow } from "./comfyWorkflow";

describe("supportsComfyWorkflow", () => {
  it("accepts PNG and the MP4 family, which is where ComfyUI writes the workflow", () => {
    const paths = [
      "C:\\Photos\\render.png",
      "C:\\Photos\\clip.mp4",
      "C:\\Photos\\clip.mov",
      "C:\\Photos\\clip.m4v",
      "C:\\Photos\\RENDER.PNG",
    ];

    expect(paths.filter((path) => !supportsComfyWorkflow(path))).toEqual([]);
  });

  it("rejects formats that carry no workflow metadata", () => {
    const paths = [
      "C:\\Photos\\photo.jpg",
      "C:\\Photos\\photo.webp",
      "C:\\Photos\\photo.bmp",
      "C:\\Photos\\loop.gif",
      "C:\\Photos\\clip.mkv",
      "C:\\Photos\\clip.avi",
      "C:\\Photos\\no-extension",
    ];

    expect(paths.filter((path) => supportsComfyWorkflow(path))).toEqual([]);
  });
});
