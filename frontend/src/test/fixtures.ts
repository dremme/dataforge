import type { BrowseResponse, GalleryItem } from "@/shared/types";

export const HOME_PATH = "C:\\Photos";

export const VACATION_PATH = `${HOME_PATH}\\Vacation`;

export const EMPTY_PATH = `${HOME_PATH}\\Empty`;

function imageItem(name: string, folder: string, options: Partial<GalleryItem> = {}): GalleryItem {
  const path = `${folder}\\${name}`;
  return {
    name,
    path,
    description: null,
    has_description: false,
    has_caption_file: false,
    has_bboxes: false,
    issue: null,
    issue_suggestions: null,
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: name.endsWith(".mp4") ? "video" : "image",
    width: 1920,
    height: 1080,
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
    has_bboxes: false,
    issue: null,
    issue_suggestions: null,
    has_issue_file: false,
    caption_status: "none",
    caption_file_type: null,
    media_type: "sysprompt",
    ...options,
  };
}

export const homeBrowse: BrowseResponse = {
  folder: HOME_PATH,
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
    imageItem("sunset.png", HOME_PATH, {
      description: "Golden hour over the lake",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
      caption_file_type: "txt",
    }),
    imageItem("beach.jpg", HOME_PATH),
    imageItem("waves.mp4", HOME_PATH),
  ],
  sysprompt: syspromptItem(HOME_PATH, {
    description: "Caption every image with rich detail.",
    has_description: true,
    caption_status: "text",
  }),
  item_count: 3,
  subfolder_count: 2,
  fingerprint: "fp-home",
};

export const vacationBrowse: BrowseResponse = {
  folder: VACATION_PATH,
  home: HOME_PATH,
  parent: HOME_PATH,
  breadcrumbs: [
    { name: "C:", path: "C:\\" },
    { name: "Photos", path: HOME_PATH },
    { name: "Vacation", path: VACATION_PATH },
  ],
  subfolders: [],
  items: [
    imageItem("lake.png", VACATION_PATH, {
      description: "Mountain lake",
      has_description: true,
      has_caption_file: true,
      caption_status: "text",
      caption_file_type: "txt",
    }),
  ],
  sysprompt: null,
  item_count: 1,
  subfolder_count: 0,
  fingerprint: "fp-vacation",
};

export const emptyBrowse: BrowseResponse = {
  folder: EMPTY_PATH,
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
  item_count: 0,
  subfolder_count: 0,
  fingerprint: "fp-empty",
};
