import { vi } from "vitest";
import type { CaptionBBox, Job, BrowseResponse } from "@/shared/types";
import { emptyBrowse, homeBrowse, vacationBrowse } from "./fixtures";

const MINIMAL_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 46,
  180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

export interface MockBackendOptions {
  failBrowse?: boolean;
  browseDelayMs?: number;
  browseByPath?: Record<string, BrowseResponse | undefined>;
}

function normalizeBrowseKey(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.replace(/\//g, "\\");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cloneBrowse(data: BrowseResponse): BrowseResponse {
  return structuredClone(data);
}

function folderLeafName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || path;
}

function createMockJob(folderPath: string, jobType: Job["job_type"] = "auto_caption"): Job {
  const now = new Date().toISOString();
  return {
    id: `job-${jobType}-${folderPath}`,
    folder: folderPath,
    folder_name: folderLeafName(folderPath),
    job_type: jobType,
    status: "queued",
    total: 0,
    processed: 0,
    stats: {},
    results: [],
    created_at: now,
  };
}

export function installMockBackend(options: MockBackendOptions = {}) {
  let folderFavorites: string[] | null = null;

  const browseByPath = Object.fromEntries(
    Object.entries(options.browseByPath ?? {}).map(([key, value]) => [
      key,
      value ? cloneBrowse(value) : value,
    ]),
  );

  const browseResponses: Record<string, BrowseResponse | undefined> = {
    undefined: cloneBrowse(homeBrowse),
    [homeBrowse.folder]: cloneBrowse(homeBrowse),
    [vacationBrowse.folder]: cloneBrowse(vacationBrowse),
    [emptyBrowse.folder]: cloneBrowse(emptyBrowse),
    ...browseByPath,
  };

  const getFavoritePaths = () => folderFavorites ?? [homeBrowse.home];

  const buildFavoritesResponse = () => ({
    favorites: getFavoritePaths().map((path) => ({
      path,
      name: path === homeBrowse.home ? "Home" : folderLeafName(path),
    })),
  });

  const isDriveRoot = (path: string) => /^[A-Za-z]:\\$/i.test(path);

  const folderExists = (path: string | null | undefined) => {
    const pathKey = normalizeBrowseKey(path);
    if (!pathKey) return false;
    if (browseResponses[pathKey] !== undefined) return true;
    return isDriveRoot(pathKey);
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestUrl, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/api/folders/favorites") {
      const favoritePath = normalizeBrowseKey(url.searchParams.get("path"));

      if (method === "GET") {
        return jsonResponse(buildFavoritesResponse());
      }

      if (method === "POST") {
        if (!favoritePath || !folderExists(favoritePath)) {
          return jsonResponse({ detail: "Folder not found" }, 404);
        }

        const paths = [...getFavoritePaths()];
        if (!paths.some((entry) => normalizeBrowseKey(entry) === favoritePath)) {
          paths.push(favoritePath);
        }
        folderFavorites = paths;
        return jsonResponse(buildFavoritesResponse());
      }

      if (method === "DELETE") {
        if (!favoritePath) {
          return jsonResponse({ detail: "Folder not found" }, 404);
        }

        folderFavorites = getFavoritePaths().filter(
          (entry) => normalizeBrowseKey(entry) !== favoritePath,
        );
        return jsonResponse(buildFavoritesResponse());
      }
    }

    if (url.pathname === "/api/folders/open" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path"));
      if (!folderPath || !folderExists(folderPath)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      return jsonResponse({ path: folderPath });
    }

    if (url.pathname === "/api/folders/create" && method === "POST") {
      const parentPath = normalizeBrowseKey(url.searchParams.get("path"));
      const folderName = url.searchParams.get("name")?.trim() ?? "";

      if (!parentPath || !folderExists(parentPath)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      if (!folderName || /[<>:"/\\|?*]/.test(folderName)) {
        return jsonResponse({ detail: "Invalid folder name" }, 400);
      }

      const createdPath = `${parentPath.replace(/[/\\]+$/, "")}\\${folderName}`;
      const parentBrowse = browseResponses[parentPath];
      if (!parentBrowse) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      if (
        parentBrowse.subfolders.some(
          (entry) => entry.name.toLowerCase() === folderName.toLowerCase(),
        )
      ) {
        return jsonResponse({ detail: "Folder already exists" }, 409);
      }

      const createdSubfolder = {
        name: folderName,
        path: createdPath,
        file_count: 0,
        captioned_count: 0,
        issue_count: 0,
      };

      parentBrowse.subfolders = [...parentBrowse.subfolders, createdSubfolder].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
      parentBrowse.subfolder_count = parentBrowse.subfolders.length;

      browseResponses[createdPath] = {
        ...cloneBrowse(parentBrowse),
        folder: createdPath,
        parent: parentPath,
        breadcrumbs: [...parentBrowse.breadcrumbs, { name: folderName, path: createdPath }],
        subfolders: [],
        items: [],
        item_count: 0,
        subfolder_count: 0,
        fingerprint: `${createdPath}-empty`,
      };

      return jsonResponse(createdSubfolder);
    }

    if (url.pathname === "/api/folders/roots") {
      return jsonResponse({
        home: homeBrowse.home,
        roots: [
          { name: "Home", path: homeBrowse.home },
          { name: "C:\\", path: "C:\\" },
        ],
      });
    }

    if (url.pathname === "/api/browse/fingerprint") {
      const rawPath = url.searchParams.get("path");
      const pathKey = normalizeBrowseKey(rawPath);
      const data =
        rawPath === null || rawPath === "" ? browseResponses.undefined : browseResponses[pathKey!];
      if (!data) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      return jsonResponse({ fingerprint: data.fingerprint });
    }

    if (url.pathname === "/api/browse") {
      if (options.browseDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.browseDelayMs));
      }

      if (options.failBrowse) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const rawPath = url.searchParams.get("path");
      const pathKey = normalizeBrowseKey(rawPath);
      const data =
        rawPath === null || rawPath === "" ? browseResponses.undefined : browseResponses[pathKey!];
      if (!data) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      return jsonResponse(data);
    }

    if (url.pathname === "/api/system/specs") {
      return jsonResponse({
        cpu_name: "Intel Core i7-12700K 12-Core Processor",
        cpu_cores: 16,
        memory_total_bytes: 32 * 1024 ** 3,
        memory_available_bytes: 24 * 1024 ** 3,
        gpu_name: "NVIDIA GeForce RTX 3080",
        gpu_memory_bytes: 10 * 1024 ** 3,
        gpu_available: true,
      });
    }

    if (url.pathname === "/api/preferences/ui") {
      if (method === "PUT") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return jsonResponse({ sort: body.sort ?? "name-asc" });
      }

      return jsonResponse({ sort: "name-asc" });
    }

    if (url.pathname === "/api/preferences/body-parts") {
      if (method === "PUT") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return jsonResponse({
          body_description: typeof body.body_description === "string" ? body.body_description : "",
          face_description: typeof body.face_description === "string" ? body.face_description : "",
          keywords: typeof body.keywords === "string" ? body.keywords : "",
          element_description:
            typeof body.element_description === "string" ? body.element_description : "",
        });
      }

      return jsonResponse({
        body_description: "",
        face_description: "",
        keywords: "",
        element_description: "",
      });
    }

    if (url.pathname === "/api/preferences/verify-captions") {
      if (method === "PUT") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const mode = body.mode === "thinking" || body.mode === "instruct" ? body.mode : "instruct";
        return jsonResponse({
          mode,
          context: typeof body.context === "string" ? body.context : "",
        });
      }

      return jsonResponse({
        mode: "instruct",
        context: "",
      });
    }

    if (url.pathname === "/api/sysprompt" && method === "PUT") {
      const path = url.searchParams.get("path") ?? "";
      const body = init?.body ? JSON.parse(init.body as string) : { text: "" };
      const text = typeof body.text === "string" ? body.text : "";

      return jsonResponse({
        description: text || null,
        has_description: text.length > 0,
        has_caption_file: true,
        caption_status: text.length > 0 ? "text" : "empty",
        path,
      });
    }

    if (url.pathname === "/api/caption" && method === "GET") {
      const path = url.searchParams.get("path") ?? "";
      const browseData =
        browseResponses[
          Object.keys(browseResponses).find(
            (key) =>
              key !== "undefined" && browseResponses[key]?.items.some((item) => item.path === path),
          ) ?? ""
        ];
      const item = browseData?.items.find((entry) => entry.path === path);

      const captionText = item?.description ?? "";
      const captionFileType = item?.caption_file_type ?? null;
      const captionContent =
        captionFileType === "json" && captionText.length > 0
          ? `${JSON.stringify(
              {
                description: captionText,
                ...((item?.bboxes ?? []).length > 0
                  ? {
                      elements: (item?.bboxes ?? []).map((bbox) => ({
                        desc: bbox.label ?? "Element",
                        bbox: [bbox.y1, bbox.x1, bbox.y2, bbox.x2],
                      })),
                    }
                  : {}),
              },
              null,
              2,
            )}\n`
          : captionText.length > 0
            ? `${captionText}\n`
            : null;

      return jsonResponse({
        description: item?.description ?? null,
        has_description: item?.has_description ?? false,
        has_caption_file: item?.has_caption_file ?? false,
        caption_status: item?.caption_status ?? "none",
        caption_file: path.replace(/\.[^.]+$/, captionFileType === "json" ? ".json" : ".txt"),
        caption_file_type: captionFileType,
        caption_content: captionContent,
        has_bboxes: item?.has_bboxes ?? false,
        bboxes: item?.bboxes ?? [],
      });
    }

    if (url.pathname === "/api/caption" && method === "PUT") {
      const path = url.searchParams.get("path") ?? "";
      const body = init?.body ? JSON.parse(init.body as string) : { text: "" };
      const jsonContent = typeof body.json_content === "string" ? body.json_content : null;
      const text = typeof body.text === "string" ? body.text : "";
      const hasDescription = text.length > 0;
      const resolveIssue = body.resolve_issue === true;
      let savedItem: (typeof homeBrowse.items)[number] | undefined;

      for (const browseData of Object.values(browseResponses)) {
        if (!browseData) continue;
        const item = browseData.items.find((entry) => entry.path === path);
        if (!item) continue;
        savedItem = item;

        if (jsonContent) {
          try {
            const parsed = JSON.parse(jsonContent) as {
              description?: string;
              elements?: Array<{ desc?: string; bbox?: number[] }>;
            };
            const description = typeof parsed.description === "string" ? parsed.description : null;
            item.description = description;
            item.has_description = Boolean(description);
            item.has_caption_file = true;
            item.caption_status = description ? "text" : "empty";
            item.caption_file_type = "json";
            item.has_bboxes = Array.isArray(parsed.elements) && parsed.elements.length > 0;
            item.bboxes = (parsed.elements ?? [])
              .map((element) => {
                const bbox = element.bbox;
                if (!Array.isArray(bbox) || bbox.length !== 4) return null;
                return {
                  x1: bbox[1],
                  y1: bbox[0],
                  x2: bbox[3],
                  y2: bbox[2],
                  label: element.desc,
                };
              })
              .filter((bbox): bbox is NonNullable<typeof bbox> => bbox !== null);
            if (resolveIssue) {
              item.issue = null;
              item.issue_suggestions = null;
              item.has_issue_file = false;
            }
          } catch {
            return jsonResponse({ detail: "Invalid JSON" }, 400);
          }
          continue;
        }

        const bodyBboxes = Array.isArray(body.bboxes) ? body.bboxes : null;
        const keepJson =
          item.caption_file_type === "json" || (bodyBboxes !== null && bodyBboxes.length > 0);

        item.description = hasDescription ? text : null;
        item.has_description = hasDescription;
        item.has_caption_file = true;
        item.caption_status = hasDescription
          ? "text"
          : keepJson && !hasDescription
            ? "bboxes_only"
            : "empty";
        if (keepJson) {
          item.caption_file_type = "json";
          if (bodyBboxes) {
            item.bboxes = bodyBboxes;
            item.has_bboxes = bodyBboxes.length > 0;
          }
        } else {
          item.caption_file_type = "txt";
        }

        if (resolveIssue) {
          item.issue = null;
          item.issue_suggestions = null;
          item.has_issue_file = false;
        }
      }

      const issueFields = {
        issue: savedItem?.issue ?? null,
        issue_suggestions: savedItem?.issue_suggestions ?? null,
        has_issue_file: savedItem?.has_issue_file ?? false,
      };

      if (jsonContent) {
        let parsed: {
          description?: string;
          elements?: Array<{ desc?: string; bbox?: number[] }>;
        };
        try {
          parsed = JSON.parse(jsonContent);
        } catch {
          return jsonResponse({ detail: "Invalid JSON" }, 400);
        }

        const description = typeof parsed.description === "string" ? parsed.description : null;
        const bboxes = (parsed.elements ?? [])
          .map((element) => {
            const bbox = element.bbox;
            if (!Array.isArray(bbox) || bbox.length !== 4) return null;
            return {
              x1: bbox[1],
              y1: bbox[0],
              x2: bbox[3],
              y2: bbox[2],
              label: element.desc,
            };
          })
          .filter((bbox): bbox is NonNullable<typeof bbox> => bbox !== null);

        return jsonResponse({
          description,
          has_description: Boolean(description),
          has_caption_file: true,
          caption_status: description ? "text" : "empty",
          caption_file: path.replace(/\.[^.]+$/, ".json"),
          caption_file_type: "json",
          caption_content: `${jsonContent.trim()}\n`,
          has_bboxes: bboxes.length > 0,
          bboxes,
          ...issueFields,
        });
      }

      const bodyBboxes = Array.isArray(body.bboxes) ? (body.bboxes as CaptionBBox[]) : null;
      const responseIsJson =
        savedItem?.caption_file_type === "json" || (bodyBboxes !== null && bodyBboxes.length > 0);
      const responseBboxes: CaptionBBox[] = bodyBboxes ?? savedItem?.bboxes ?? [];

      if (responseIsJson) {
        const jsonCaptionContent =
          typeof savedItem?.description === "string"
            ? JSON.stringify(
                {
                  description: text || savedItem.description,
                  elements: responseBboxes.map((bbox) => ({
                    desc: bbox.label ?? "Element",
                    bbox: [bbox.y1, bbox.x1, bbox.y2, bbox.x2],
                  })),
                },
                null,
                2,
              ) + "\n"
            : JSON.stringify({ description: text, elements: [] }, null, 2) + "\n";

        return jsonResponse({
          description: text || null,
          has_description: hasDescription,
          has_caption_file: true,
          caption_status: hasDescription
            ? "text"
            : responseBboxes.length > 0
              ? "bboxes_only"
              : "empty",
          caption_file: path.replace(/\.[^.]+$/, ".json"),
          caption_file_type: "json",
          caption_content: jsonCaptionContent,
          has_bboxes: responseBboxes.length > 0,
          bboxes: responseBboxes,
          ...issueFields,
        });
      }

      return jsonResponse({
        description: text || null,
        has_description: hasDescription,
        has_caption_file: true,
        caption_status: hasDescription ? "text" : "empty",
        caption_file: path.replace(/\.[^.]+$/, ".txt"),
        caption_file_type: "txt",
        caption_content: text.length > 0 ? `${text}\n` : "",
        has_bboxes: false,
        ...issueFields,
      });
    }

    if (url.pathname === "/api/comfy-workflow") {
      return jsonResponse({ has_workflow: false });
    }

    if (url.pathname === "/api/media/open" && method === "POST") {
      const path = url.searchParams.get("path") ?? "";
      const fileName = path.split(/[/\\]/).pop() ?? "";
      const isImage = /\.(png|jpe?g)$/i.test(fileName);

      if (!path || !isImage) {
        return jsonResponse({ detail: "Only image files can be opened in the image viewer" }, 400);
      }

      return jsonResponse({ path });
    }

    if (url.pathname === "/api/media/move/preview" && method === "POST") {
      const destination = normalizeBrowseKey(url.searchParams.get("destination"));
      const body = init?.body ? JSON.parse(init.body as string) : { paths: [] };
      const paths = Array.isArray(body.paths) ? body.paths : [];

      if (!destination || !folderExists(destination)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const destinationBrowse = browseResponses[destination];
      const existingNames = new Set(destinationBrowse?.items.map((item) => item.name) ?? []);
      const movable: string[] = [];
      const conflicts: string[] = [];
      const skipped: string[] = [];

      for (const path of paths) {
        const normalizedPath = normalizeBrowseKey(path);
        const fileName = normalizedPath?.split(/[/\\]/).pop();
        if (!normalizedPath || !fileName) continue;

        const parent = normalizedPath.replace(/[/\\][^/\\]+$/, "");
        if (parent === destination) {
          skipped.push(normalizedPath);
          continue;
        }

        if (existingNames.has(fileName)) {
          conflicts.push(fileName);
        } else {
          movable.push(fileName);
        }
      }

      return jsonResponse({ movable, conflicts, skipped });
    }

    if (url.pathname === "/api/media/move" && method === "POST") {
      const destination = normalizeBrowseKey(url.searchParams.get("destination"));
      const overwrite = url.searchParams.get("overwrite") === "true";
      const body = init?.body ? JSON.parse(init.body as string) : { paths: [] };
      const paths = Array.isArray(body.paths) ? body.paths : [];

      if (!destination || !folderExists(destination)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const destinationBrowse = browseResponses[destination];
      if (!destinationBrowse) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const moved: Array<{ source: string; destination: string; moved: string[] }> = [];
      const skipped: string[] = [];
      const failed: Array<{ path: string; detail: string }> = [];

      for (const path of paths) {
        const normalizedPath = normalizeBrowseKey(path);
        if (!normalizedPath) continue;

        const fileName = normalizedPath.split(/[/\\]/).pop() ?? "";
        const parent = normalizedPath.replace(/[/\\][^/\\]+$/, "");
        const existingIndex = destinationBrowse.items.findIndex(
          (item) => item.name.toLowerCase() === fileName.toLowerCase(),
        );

        if (parent === destination) {
          skipped.push(normalizedPath);
          continue;
        }

        if (existingIndex >= 0 && !overwrite) {
          continue;
        }

        let sourceBrowse: BrowseResponse | undefined;
        for (const browseData of Object.values(browseResponses)) {
          if (!browseData) continue;
          const index = browseData.items.findIndex((entry) => entry.path === normalizedPath);
          if (index >= 0) {
            sourceBrowse = browseData;
            const [item] = browseData.items.splice(index, 1);
            browseData.item_count = browseData.items.length;

            if (existingIndex >= 0) {
              destinationBrowse.items.splice(existingIndex, 1);
            }

            const destinationPath = `${destination.replace(/[/\\]+$/, "")}\\${item.name}`;
            destinationBrowse.items.push({ ...item, path: destinationPath });
            destinationBrowse.item_count = destinationBrowse.items.length;

            const movedNames = [item.name];
            if (item.has_caption_file) {
              movedNames.push(
                item.name.replace(/\.[^.]+$/, item.caption_file_type === "json" ? ".json" : ".txt"),
              );
            }

            moved.push({
              source: normalizedPath,
              destination: destinationPath,
              moved: movedNames,
            });
            break;
          }
        }

        if (!sourceBrowse) {
          failed.push({ path: normalizedPath, detail: "Media file not found" });
        }
      }

      return jsonResponse({ moved, skipped, failed });
    }

    if (url.pathname === "/api/media") {
      if (method === "DELETE") {
        const path = url.searchParams.get("path") ?? "";
        const deleted = [path.split(/[/\\]/).pop() ?? "file"];

        for (const browseData of Object.values(browseResponses)) {
          if (!browseData) continue;
          const index = browseData.items.findIndex((entry) => entry.path === path);
          if (index < 0) continue;
          const item = browseData.items[index];
          browseData.items.splice(index, 1);
          browseData.item_count = browseData.items.length;
          if (item.caption_file_type === "json") {
            deleted.push(item.name.replace(/\.[^.]+$/, ".json"));
          } else if (item.has_caption_file) {
            deleted.push(item.name.replace(/\.[^.]+$/, ".txt"));
          }
          break;
        }

        return jsonResponse({ path, deleted });
      }

      return new Response(MINIMAL_PNG, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }

    if (url.pathname === "/api/thumbnail") {
      return new Response(MINIMAL_PNG, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (url.pathname === "/api/automation/auto-caption" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path")) ?? homeBrowse.folder;
      return jsonResponse(createMockJob(folderPath, "auto_caption"));
    }

    if (url.pathname === "/api/automation/body-parts" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path")) ?? homeBrowse.folder;
      return jsonResponse(createMockJob(folderPath, "body_parts"));
    }

    if (url.pathname === "/api/automation/strip-metadata" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path")) ?? homeBrowse.folder;
      return jsonResponse(createMockJob(folderPath, "strip_metadata"));
    }

    if (url.pathname === "/api/automation/set-captions" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path")) ?? homeBrowse.folder;
      return jsonResponse(createMockJob(folderPath, "set_captions"));
    }

    if (url.pathname === "/api/automation/batch-rename" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path")) ?? homeBrowse.folder;
      return jsonResponse(createMockJob(folderPath, "batch_rename"));
    }

    if (url.pathname === "/api/automation/verify-captions" && method === "POST") {
      const folderPath = normalizeBrowseKey(url.searchParams.get("path")) ?? homeBrowse.folder;
      return jsonResponse(createMockJob(folderPath, "verify_captions"));
    }

    if (url.pathname === "/api/jobs") {
      if (method === "DELETE") {
        return jsonResponse({ deleted_count: 0 });
      }

      return jsonResponse({ jobs: [], active_count: 0 });
    }

    if (url.pathname === "/api/jobs/folder-latest") {
      return jsonResponse(null);
    }

    if (url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
      return jsonResponse(createMockJob(homeBrowse.folder));
    }

    if (url.pathname.startsWith("/api/jobs/") && method === "DELETE") {
      // single delete
      return jsonResponse({ deleted_count: 1 });
    }

    return new Response("Not found", { status: 404 });
  });

  const removeBrowseFolder = (path: string) => {
    const pathKey = normalizeBrowseKey(path);
    if (pathKey) {
      delete browseResponses[pathKey];
    }
  };

  vi.stubGlobal("fetch", fetchMock);

  return { fetchMock, removeBrowseFolder };
}
