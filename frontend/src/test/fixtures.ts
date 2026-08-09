import type { FolderResponse, GalleryItem, Job } from "@/shared/types";

export const HOME_PATH = "C:\\Photos";

export const VACATION_PATH = `${HOME_PATH}\\Vacation`;

export const EMPTY_PATH = `${HOME_PATH}\\Empty`;

const MEDIA_TYPE_BY_EXTENSION: Record<string, GalleryItem["media_type"]> = {
  ".mp4": "video",
  ".gif": "gif",
};

/**
 * A gallery item typed from its own extension.
 *
 * Mapped rather than tested against one suffix so a fixture named `loop.gif` can
 * never quietly come back as an image and let a GIF test pass on the wrong type.
 */
export function mediaItem(
  name: string,
  folder: string,
  options: Partial<GalleryItem> = {},
): GalleryItem {
  const path = `${folder}\\${name}`;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return {
    name,
    path,
    description: null,
    has_description: false,
    has_caption_file: false,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: MEDIA_TYPE_BY_EXTENSION[extension] ?? "image",
    width: 1920,
    height: 1080,
    ...options,
  };
}

/**
 * A queued job with nothing done yet.
 *
 * The server always sends `folder_name` and `job_type`, so both are required on the
 * wire; spelling them out in every test is what this exists to avoid.
 */
export function job(options: Partial<Job> = {}): Job {
  const folder = options.folder ?? HOME_PATH;
  return {
    id: "job-1",
    folder,
    folder_name: folder.slice(folder.lastIndexOf("\\") + 1),
    job_type: "auto_caption",
    status: "queued",
    total: 0,
    processed: 0,
    stats: {},
    created_at: "2026-01-01T00:00:00.000Z",
    ...options,
  };
}

function syspromptItem(folder: string, options: Partial<GalleryItem> = {}): GalleryItem {
  return {
    name: ".sysprompt",
    path: `${folder}\\.sysprompt`,
    description: null,
    has_description: false,
    has_caption_file: true,
    issue_fixes: [],
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: "sysprompt",
    ...options,
  };
}

export const homeFolder: FolderResponse = {
  path: HOME_PATH,
  home: HOME_PATH,
  parent: null,
  breadcrumbs: [
    { name: "C:", path: "C:\\" },
    { name: "Photos", path: HOME_PATH },
  ],
  subfolders: [
    {
      name: "Vacation",
      path: VACATION_PATH,
      file_count: 1,
      captioned_count: 0,
      issue_count: 0,
    },
    {
      name: "Empty",
      path: EMPTY_PATH,
      file_count: 0,
      captioned_count: 0,
      issue_count: 0,
    },
  ],
  items: [
    mediaItem("sunset.png", HOME_PATH, {
      description: "Golden hour over the lake",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
      caption_file_type: "txt",
    }),
    mediaItem("beach.jpg", HOME_PATH),
    mediaItem("waves.mp4", HOME_PATH),
  ],
  sysprompt: syspromptItem(HOME_PATH, {
    description: "Caption every image with rich detail.",
    has_description: true,
    caption_status: "text",
  }),
  has_caption_backup: false,
  item_count: 3,
  subfolder_count: 2,
  fingerprint: "fp-home",
};

export const vacationFolder: FolderResponse = {
  path: VACATION_PATH,
  home: HOME_PATH,
  parent: HOME_PATH,
  breadcrumbs: [
    { name: "C:", path: "C:\\" },
    { name: "Photos", path: HOME_PATH },
    { name: "Vacation", path: VACATION_PATH },
  ],
  subfolders: [],
  items: [
    mediaItem("lake.png", VACATION_PATH, {
      description: "Mountain lake",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
      caption_file_type: "txt",
    }),
  ],
  sysprompt: null,
  has_caption_backup: false,
  item_count: 1,
  subfolder_count: 0,
  fingerprint: "fp-vacation",
};

export const emptyFolder: FolderResponse = {
  path: EMPTY_PATH,
  home: HOME_PATH,
  parent: HOME_PATH,
  breadcrumbs: [
    { name: "C:", path: "C:\\" },
    { name: "Photos", path: HOME_PATH },
    { name: "Empty", path: EMPTY_PATH },
  ],
  subfolders: [],
  items: [],
  sysprompt: null,
  has_caption_backup: false,
  item_count: 0,
  subfolder_count: 0,
  fingerprint: "fp-empty",
};
