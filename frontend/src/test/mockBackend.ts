import { vi } from "vitest";
import { clearFolderCache } from "@/features/folder/lib/folderCache";
import { clearFolderScrollMemory } from "@/features/folder/lib/folderScrollMemory";
import type {
  CaptionSaveResponse,
  FolderChangesResponse,
  Job,
  FolderResponse,
} from "@/shared/types";
import { emptyFolder, homeFolder, vacationFolder } from "./fixtures";

const MINIMAL_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 46,
  180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

export interface MockBackendOptions {
  failFolder?: boolean;
  folderDelayMs?: number;
  folderByPath?: Record<string, FolderResponse | undefined>;
}

function normalizeFolderKey(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.replace(/\//g, "\\");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function cloneFolder(data: FolderResponse): FolderResponse {
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
    created_at: now,
  };
}

export function installMockBackend(options: MockBackendOptions = {}) {
  let folderFavorites: string[] | null = null;

  // Module singletons; leftover payloads from an earlier test would skip this mock.
  clearFolderCache();
  clearFolderScrollMemory();

  const folderByPath = Object.fromEntries(
    Object.entries(options.folderByPath ?? {}).map(([key, value]) => [
      key,
      value ? cloneFolder(value) : value,
    ]),
  );

  const folderResponses: Record<string, FolderResponse | undefined> = {
    undefined: cloneFolder(homeFolder),
    [homeFolder.path]: cloneFolder(homeFolder),
    [vacationFolder.path]: cloneFolder(vacationFolder),
    [emptyFolder.path]: cloneFolder(emptyFolder),
    ...folderByPath,
  };

  const getFavoritePaths = () => folderFavorites ?? [homeFolder.home];

  const buildFavoritesResponse = () => ({
    favorites: getFavoritePaths().map((path) => ({
      path,
      name: path === homeFolder.home ? "Home" : folderLeafName(path),
    })),
  });

  const folderDeltas: Record<string, { since: string; report: FolderChangesResponse }[]> = {};

  const isDriveRoot = (path: string) => /^[A-Za-z]:\\$/i.test(path);

  const folderExists = (path: string | null | undefined) => {
    const pathKey = normalizeFolderKey(path);
    if (!pathKey) return false;
    if (folderResponses[pathKey] !== undefined) return true;
    return isDriveRoot(pathKey);
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(requestUrl, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/api/folders/favorites") {
      const favoritePath = normalizeFolderKey(url.searchParams.get("path"));

      if (method === "GET") {
        return jsonResponse(buildFavoritesResponse());
      }

      if (method === "POST") {
        if (!favoritePath || !folderExists(favoritePath)) {
          return jsonResponse({ detail: "Folder not found" }, 404);
        }

        const paths = [...getFavoritePaths()];
        if (!paths.some((entry) => normalizeFolderKey(entry) === favoritePath)) {
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
          (entry) => normalizeFolderKey(entry) !== favoritePath,
        );
        return jsonResponse(buildFavoritesResponse());
      }
    }

    if (url.pathname === "/api/folders/open" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path"));
      if (!folderPath || !folderExists(folderPath)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      return jsonResponse({ path: folderPath });
    }

    if (url.pathname === "/api/folders/create" && method === "POST") {
      const parentPath = normalizeFolderKey(url.searchParams.get("path"));
      const folderName = url.searchParams.get("name")?.trim() ?? "";

      if (!parentPath || !folderExists(parentPath)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      if (!folderName || /[<>:"/\\|?*]/.test(folderName)) {
        return jsonResponse({ detail: "Invalid folder name" }, 400);
      }

      const createdPath = `${parentPath.replace(/[/\\]+$/, "")}\\${folderName}`;
      const parentFolder = folderResponses[parentPath];
      if (!parentFolder) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      if (
        parentFolder.subfolders.some(
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

      parentFolder.subfolders = [...parentFolder.subfolders, createdSubfolder].sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );
      parentFolder.subfolder_count = parentFolder.subfolders.length;

      folderResponses[createdPath] = {
        ...cloneFolder(parentFolder),
        path: createdPath,
        parent: parentPath,
        breadcrumbs: [...parentFolder.breadcrumbs, { name: folderName, path: createdPath }],
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
        home: homeFolder.home,
        roots: [
          { name: "Home", path: homeFolder.home },
          { name: "C:\\", path: "C:\\" },
        ],
      });
    }

    if (url.pathname === "/api/folders/children") {
      const rawPath = url.searchParams.get("path");
      const pathKey = normalizeFolderKey(rawPath);
      if (!pathKey || !folderExists(pathKey)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const data = folderResponses[pathKey];
      const children = (data?.subfolders ?? []).map((entry) => ({
        name: entry.name,
        path: entry.path,
      }));
      return jsonResponse({ folder: pathKey, children });
    }

    if (url.pathname === "/api/folders/fingerprint") {
      const rawPath = url.searchParams.get("path");
      const pathKey = normalizeFolderKey(rawPath);
      const data =
        rawPath === null || rawPath === "" ? folderResponses.undefined : folderResponses[pathKey!];
      if (!data) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      return jsonResponse({ fingerprint: data.fingerprint });
    }

    if (url.pathname === "/api/folders/changes") {
      const pathKey = normalizeFolderKey(url.searchParams.get("path"));
      const data = pathKey ? folderResponses[pathKey] : undefined;
      if (!pathKey || !data) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const since = url.searchParams.get("since") ?? "";
      const delta = folderDeltas[pathKey]?.find((entry) => entry.since === since);
      if (delta) {
        return jsonResponse(delta.report);
      }

      return jsonResponse({
        full: since !== data.fingerprint,
        fingerprint: data.fingerprint,
        changed: [],
        removed: [],
      });
    }

    if (url.pathname === "/api/folders/subfolder-stats") {
      const pathKey = normalizeFolderKey(url.searchParams.get("path"));
      const data = pathKey ? folderResponses[pathKey] : undefined;
      if (!data) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      return jsonResponse({
        folder: data.path,
        subfolders: data.subfolders.map((entry) => ({
          path: entry.path,
          file_count: entry.file_count ?? 0,
          captioned_count: entry.captioned_count ?? 0,
          issue_count: entry.issue_count ?? 0,
        })),
      });
    }

    if (url.pathname === "/api/folders/contents") {
      if (options.folderDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.folderDelayMs));
      }

      if (options.failFolder) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const rawPath = url.searchParams.get("path");
      const pathKey = normalizeFolderKey(rawPath);
      const data =
        rawPath === null || rawPath === "" ? folderResponses.undefined : folderResponses[pathKey!];
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
        memory_used_bytes: 8 * 1024 ** 3,
        gpu_name: "NVIDIA GeForce RTX 3080",
        gpu_memory_bytes: 10 * 1024 ** 3,
        gpu_memory_used_bytes: 4 * 1024 ** 3,
        gpu_available: true,
      });
    }

    if (url.pathname === "/api/system/vision-llm") {
      return jsonResponse({ model: "qwen38" });
    }

    if (url.pathname === "/api/preferences/ui") {
      if (method === "PUT") {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        return jsonResponse({ sort: body.sort ?? "name-asc" });
      }

      return jsonResponse({ sort: "name-asc" });
    }

    if (url.pathname === "/api/preferences/automation") {
      return jsonResponse({
        folder_path: url.searchParams.get("path") ?? "",
        auto_caption: {
          mode: "thinking",
          reasoning_effort: "medium",
          preserve_thinking: true,
          caption_audio: false,
        },
        set_captions: { caption: "" },
        replace_captions: {
          mode: "replace",
          search: "",
          replacement: "",
          use_regex: false,
          case_sensitive: false,
        },
        backup_captions: {},
        verify_captions: {
          mode: "instruct",
          reasoning_effort: "medium",
          preserve_thinking: true,
          context: "",
        },
        edit_captions: {
          mode: "instruct",
          reasoning_effort: "medium",
          preserve_thinking: true,
          instruction: "",
        },
        batch_rename: { stem: "", start_number: 1 },
        find_duplicates: { threshold: "near" },
        train_lora: { trigger_word: "", prompts: [], model: "krea2_turbo" },
        watermark: {
          text: "",
          size: "medium",
          opacity: 50,
          position: "bottom",
          strip_metadata: false,
        },
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
      const folderData =
        folderResponses[
          Object.keys(folderResponses).find(
            (key) =>
              key !== "undefined" && folderResponses[key]?.items.some((item) => item.path === path),
          ) ?? ""
        ];
      const item = folderData?.items.find((entry) => entry.path === path);

      const caption: CaptionSaveResponse = {
        description: item?.description ?? null,
        has_description: item?.has_description ?? false,
        has_caption_file: item?.has_caption_file ?? false,
        caption_status: item?.caption_status ?? "none",
        caption_file: path.replace(/\.[^.]+$/, ".txt"),
        issue_fixes: item?.issue_fixes ?? [],
        has_issue_file: item?.has_issue_file ?? false,
      };
      return jsonResponse(caption);
    }

    if (url.pathname === "/api/caption" && method === "PUT") {
      const path = url.searchParams.get("path") ?? "";
      const body = init?.body ? JSON.parse(init.body as string) : { text: "" };
      const text = typeof body.text === "string" ? body.text : "";
      const hasDescription = text.length > 0;
      const resolveIssue = body.resolve_issue === true;
      let savedItem: (typeof homeFolder.items)[number] | undefined;

      for (const folderData of Object.values(folderResponses)) {
        if (!folderData) continue;
        const item = folderData.items.find((entry) => entry.path === path);
        if (!item) continue;
        savedItem = item;

        item.description = hasDescription ? text : null;
        item.has_description = hasDescription;
        item.has_caption_file = true;
        item.caption_status = hasDescription ? "text" : "empty";

        if (resolveIssue) {
          item.issue_fixes = [];
          item.has_issue_file = false;
        }
      }

      const issueFields = {
        issue_fixes: savedItem?.issue_fixes ?? [],
        has_issue_file: savedItem?.has_issue_file ?? false,
      };

      return jsonResponse({
        description: text || null,
        has_description: hasDescription,
        has_caption_file: true,
        caption_status: hasDescription ? "text" : "empty",
        caption_file: path.replace(/\.[^.]+$/, ".txt"),
        ...issueFields,
      });
    }

    if (url.pathname === "/api/comfy-workflow") {
      return jsonResponse({ has_workflow: false });
    }

    if (url.pathname === "/api/comfy-workflow/prompts") {
      return jsonResponse({
        has_workflow: false,
        branches: [],
        matched_node_id: null,
        orphan_prompts: [],
      });
    }

    if (url.pathname === "/api/media/open" && method === "POST") {
      const path = url.searchParams.get("path") ?? "";
      const fileName = path.split(/[/\\]/).pop() ?? "";
      const isImage = /\.(png|jpe?g|webp|bmp)$/i.test(fileName);

      if (!path || !isImage) {
        return jsonResponse({ detail: "Only image files can be opened in the image viewer" }, 400);
      }

      return jsonResponse({ path });
    }

    if (
      (url.pathname === "/api/media/move/preview" || url.pathname === "/api/media/copy/preview") &&
      method === "POST"
    ) {
      const destination = normalizeFolderKey(url.searchParams.get("destination"));
      const body = init?.body ? JSON.parse(init.body as string) : { paths: [] };
      const paths = Array.isArray(body.paths) ? body.paths : [];

      if (!destination || !folderExists(destination)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const destinationFolder = folderResponses[destination];
      const existingNames = new Set(destinationFolder?.items.map((item) => item.name) ?? []);
      const eligible: string[] = [];
      const conflicts: string[] = [];
      const skipped: string[] = [];

      for (const path of paths) {
        const normalizedPath = normalizeFolderKey(path);
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
          eligible.push(fileName);
        }
      }

      return jsonResponse({ eligible, conflicts, skipped });
    }

    if (
      (url.pathname === "/api/media/move" || url.pathname === "/api/media/copy") &&
      method === "POST"
    ) {
      const isCopy = url.pathname === "/api/media/copy";
      const destination = normalizeFolderKey(url.searchParams.get("destination"));
      const overwrite = url.searchParams.get("overwrite") === "true";
      const body = init?.body ? JSON.parse(init.body as string) : { paths: [] };
      const paths = Array.isArray(body.paths) ? body.paths : [];

      if (!destination || !folderExists(destination)) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const destinationFolder = folderResponses[destination];
      if (!destinationFolder) {
        return jsonResponse({ detail: "Folder not found" }, 404);
      }

      const transferred: Array<{ source: string; destination: string; files: string[] }> = [];
      const skipped: string[] = [];
      const failed: Array<{ path: string; detail: string }> = [];

      for (const path of paths) {
        const normalizedPath = normalizeFolderKey(path);
        if (!normalizedPath) continue;

        const fileName = normalizedPath.split(/[/\\]/).pop() ?? "";
        const parent = normalizedPath.replace(/[/\\][^/\\]+$/, "");
        const existingIndex = destinationFolder.items.findIndex(
          (item) => item.name.toLowerCase() === fileName.toLowerCase(),
        );

        if (parent === destination) {
          skipped.push(normalizedPath);
          continue;
        }

        if (existingIndex >= 0 && !overwrite) {
          continue;
        }

        let sourceFolder: FolderResponse | undefined;
        for (const folderData of Object.values(folderResponses)) {
          if (!folderData) continue;
          const index = folderData.items.findIndex((entry) => entry.path === normalizedPath);
          if (index >= 0) {
            sourceFolder = folderData;
            const item = isCopy ? folderData.items[index] : folderData.items.splice(index, 1)[0];
            folderData.item_count = folderData.items.length;

            if (existingIndex >= 0) {
              destinationFolder.items.splice(existingIndex, 1);
            }

            const destinationPath = `${destination.replace(/[/\\]+$/, "")}\\${item.name}`;
            destinationFolder.items.push({ ...item, path: destinationPath });
            destinationFolder.item_count = destinationFolder.items.length;

            const files = [item.name];
            if (item.has_caption_file) {
              files.push(item.name.replace(/\.[^.]+$/, ".txt"));
            }

            transferred.push({
              source: normalizedPath,
              destination: destinationPath,
              files,
            });
            break;
          }
        }

        if (!sourceFolder) {
          failed.push({ path: normalizedPath, detail: "Media file not found" });
        }
      }

      return jsonResponse({ transferred, skipped, failed });
    }

    if (url.pathname === "/api/media") {
      if (method === "DELETE") {
        const path = url.searchParams.get("path") ?? "";
        const deleted = [path.split(/[/\\]/).pop() ?? "file"];

        for (const folderData of Object.values(folderResponses)) {
          if (!folderData) continue;
          const index = folderData.items.findIndex((entry) => entry.path === path);
          if (index < 0) continue;
          const item = folderData.items[index];
          folderData.items.splice(index, 1);
          folderData.item_count = folderData.items.length;
          if (item.has_caption_file) {
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

    if (url.pathname === "/api/gif-info") {
      return jsonResponse({ frame_count: 24 });
    }

    if (url.pathname === "/api/gif-frame") {
      return new Response(MINIMAL_PNG, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (url.pathname === "/api/automation/auto-caption" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "auto_caption"));
    }

    if (url.pathname === "/api/automation/strip-metadata" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "strip_metadata"));
    }

    if (url.pathname === "/api/automation/set-captions" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "set_captions"));
    }

    if (url.pathname === "/api/automation/batch-rename" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "batch_rename"));
    }

    if (url.pathname === "/api/automation/verify-captions" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "verify_captions"));
    }

    if (url.pathname === "/api/automation/edit-captions" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "edit_captions"));
    }

    if (url.pathname === "/api/automation/watermark" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "watermark"));
    }

    if (url.pathname === "/api/automation/backup-captions" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "backup_captions"));
    }

    if (url.pathname === "/api/automation/restore-captions" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "restore_captions"));
    }

    if (url.pathname === "/api/automation/train-lora" && method === "POST") {
      const folderPath = normalizeFolderKey(url.searchParams.get("path")) ?? homeFolder.path;
      return jsonResponse(createMockJob(folderPath, "train_lora"));
    }

    if (
      url.pathname.startsWith("/api/external/ostris/training/") &&
      url.pathname.endsWith("/samples")
    ) {
      return jsonResponse({ samples: [], step: null, available: true });
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
      return jsonResponse(createMockJob(homeFolder.path));
    }

    if (url.pathname.startsWith("/api/jobs/") && method === "DELETE") {
      return jsonResponse({ deleted_count: 1 });
    }

    return new Response("Not found", { status: 404 });
  });

  const removeFolder = (path: string) => {
    const pathKey = normalizeFolderKey(path);
    if (pathKey) {
      delete folderResponses[pathKey];
    }
  };

  const renameItem = (folderPath: string, fromName: string, toName: string) => {
    const pathKey = normalizeFolderKey(folderPath);
    const data = pathKey ? folderResponses[pathKey] : undefined;
    const item = data?.items.find((entry) => entry.name === fromName);
    if (!pathKey || !data || !item) {
      throw new Error(`No item named ${fromName} in ${folderPath}`);
    }

    const removedPath = item.path;
    const since = data.fingerprint;

    item.name = toName;
    item.path = `${pathKey.replace(/[/\\]+$/, "")}\\${toName}`;
    data.fingerprint = `${since}-${toName}`;

    const report: FolderChangesResponse = {
      full: false,
      fingerprint: data.fingerprint,
      changed: [structuredClone(item)],
      removed: [removedPath],
    };
    (folderDeltas[pathKey] ??= []).push({ since, report });
  };

  vi.stubGlobal("fetch", fetchMock);

  return { fetchMock, removeFolder, renameItem };
}
