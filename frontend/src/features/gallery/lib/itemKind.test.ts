import { describe, expect, it } from "vitest";
import type { GalleryItem } from "@/shared/types";
import {
  isAudio,
  isAudioName,
  isEditableImage,
  isEditableVideo,
  isGif,
  isMotion,
  isVideo,
  isVideoName,
  jobEligibleItems,
  jobEligiblePaths,
  mediaLabelFor,
} from "./itemKind";

/** media_type is required on the wire; undefined reproduces a partial item for the fallback. */
function item(name: string, mediaType: GalleryItem["media_type"] | undefined): GalleryItem {
  return {
    name,
    path: `C:\\Photos\\${name}`,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    rule_findings: [],
    has_issue_file: false,
    has_duplicate_file: false,
    has_backup: false,
    tags: [],
    has_candidate: false,
    caption_status: "none",
    media_type: mediaType,
  } as GalleryItem;
}

describe("isVideoName", () => {
  it("recognises every supported video container", () => {
    expect(
      [".mp4", ".avi", ".mov", ".mkv", ".wmv", ".m4v", ".flv", ".MKV"].filter(
        (extension) => !isVideoName(`clip${extension}`),
      ),
    ).toEqual([]);
  });

  it("does not claim images or GIFs", () => {
    expect(["photo.jpg", "photo.webp", "photo.bmp", "loop.gif"].filter(isVideoName)).toEqual([]);
  });

  it("does not claim a name with no extension", () => {
    expect(isVideoName("clip")).toBe(false);
  });
});

describe("isVideo", () => {
  it("trusts the server's media_type over the extension", () => {
    expect(isVideo(item("clip.mkv", "image"))).toBe(false);
    expect(isVideo(item("still.png", "video"))).toBe(true);
  });

  it("falls back to the extension for every supported container", () => {
    const names = [
      "clip.mp4",
      "clip.avi",
      "clip.mov",
      "clip.mkv",
      "clip.wmv",
      "clip.m4v",
      "clip.flv",
      "CLIP.MKV",
    ];

    expect(names.filter((name) => !isVideo(item(name, undefined)))).toEqual([]);
  });

  it("does not claim images or GIFs", () => {
    const names = ["photo.jpg", "photo.webp", "photo.bmp", "loop.gif"];

    expect(names.filter((name) => isVideo(item(name, undefined)))).toEqual([]);
  });
});

describe("isEditableVideo", () => {
  it.each([["clip.mp4"], ["clip.mov"], ["clip.m4v"]])("offers editing for %s", (name) => {
    expect(isEditableVideo(item(name, "video"))).toBe(true);
  });

  it("refuses a container the browser cannot decode", () => {
    // ffmpeg remuxes matroska; the editor reads duration off <video>, which never decodes one.
    expect(isEditableVideo(item("clip.mkv", "video"))).toBe(false);
  });

  it.each([["clip.avi"], ["clip.wmv"], ["clip.flv"]])("refuses %s", (name) => {
    expect(isEditableVideo(item(name, "video"))).toBe(false);
  });

  it("refuses anything that is not a video at all", () => {
    expect(isEditableVideo(item("sunset.png", "image"))).toBe(false);
    expect(isEditableVideo(item("loop.gif", "gif"))).toBe(false);
  });
});

describe("isGif", () => {
  it("falls back to the extension", () => {
    expect(isGif(item("loop.gif", undefined))).toBe(true);
    expect(isGif(item("clip.mkv", undefined))).toBe(false);
  });
});

describe("isMotion", () => {
  it("covers GIFs and every video container", () => {
    expect(isMotion(item("loop.gif", "gif"))).toBe(true);
    expect(isMotion(item("clip.mkv", undefined))).toBe(true);
    expect(isMotion(item("photo.webp", undefined))).toBe(false);
  });
});

describe("isAudio", () => {
  it("trusts the server's media_type over the extension", () => {
    expect(isAudio(item("track.wav", "image"))).toBe(false);
    expect(isAudio(item("still.png", "audio"))).toBe(true);
  });

  it("falls back to the extension for WAV, MP3, and FLAC", () => {
    expect(
      ["voice.wav", "song.mp3", "SONG.MP3", "track.flac", "TRACK.FLAC"].filter(
        (name) => !isAudioName(name),
      ),
    ).toEqual([]);
    expect(["track.ogg", "clip.mp4", "photo.png"].filter(isAudioName)).toEqual([]);
    expect(isAudio(item("song.mp3", undefined))).toBe(true);
    expect(isAudio(item("track.flac", undefined))).toBe(true);
  });

  it("is neither motion nor editable", () => {
    const audio = item("song.mp3", "audio");

    expect(isMotion(audio)).toBe(false);
    expect(isEditableImage(audio)).toBe(false);
    expect(isEditableVideo(audio)).toBe(false);
  });
});

describe("job eligibility", () => {
  it("leaves audio out of the items a job would count", () => {
    const items = [item("photo.png", "image"), item("voice.wav", "audio"), item("loop.gif", "gif")];

    expect(jobEligibleItems(items).map((entry) => entry.name)).toEqual(["photo.png", "loop.gif"]);
  });

  it("leaves audio out of selected paths", () => {
    expect(
      jobEligiblePaths(["C:\\Photos\\clip.mp4", "C:\\Photos\\song.MP3", "C:\\Photos\\voice.wav"]),
    ).toEqual(["C:\\Photos\\clip.mp4"]);
  });
});

describe("mediaLabelFor", () => {
  it("names the new types", () => {
    expect(mediaLabelFor(item("clip.mov", undefined))).toBe("video");
    expect(mediaLabelFor(item("photo.bmp", undefined))).toBe("image");
    expect(mediaLabelFor(item("loop.gif", "gif"))).toBe("GIF");
    expect(mediaLabelFor(item("song.mp3", "audio"))).toBe("audio");
  });
});
