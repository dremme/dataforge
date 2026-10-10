import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { importFiles, previewFileImport } from "@/features/folder/api/files";
import { formatApiError } from "@/shared/api/http";
import { isExternalFileDrag } from "@/shared/lib/dragTransfer";
import { filterImportableFiles } from "@/features/folder/lib/importableFiles";

type OverwritePrompt = {
  conflicts: string[];
};

/** The prompt's files with the folder they were previewed against; confirming imports there. */
type PendingImport = {
  folderPath: string;
  files: File[];
};

type UseFolderFileDropOptions = {
  folderPath: string | undefined;
  enabled: boolean;
  onImported: () => Promise<void> | void;
};

export function useFolderFileDrop({ folderPath, enabled, onImported }: UseFolderFileDropOptions) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [overwritePrompt, setOverwritePrompt] = useState<OverwritePrompt | null>(null);
  const dragDepthRef = useRef(0);
  const pendingRef = useRef<PendingImport | null>(null);
  // Bumped on navigation so a preview answered for the previous folder is dropped.
  const generationRef = useRef(0);
  // Synchronous, unlike `importing`: a double click must not send the upload twice.
  const busyRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    pendingRef.current = null;
    setOverwritePrompt(null);
  }, [folderPath]);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }, []);

  const runImport = useCallback(
    async (destination: string, files: File[], overwrite: boolean) => {
      if (files.length === 0 || busyRef.current) {
        return;
      }

      busyRef.current = true;
      setImporting(true);
      setImportError(null);

      try {
        const result = await importFiles(destination, files, overwrite);
        if (result.copied.length > 0) {
          await onImported();
        }
      } catch (error) {
        setImportError(formatApiError(error));
      } finally {
        busyRef.current = false;
        setImporting(false);
        pendingRef.current = null;
        setOverwritePrompt(null);
        resetDragState();
      }
    },
    [onImported, resetDragState],
  );

  const beginImport = useCallback(
    async (files: File[]) => {
      if (!folderPath || !enabled || importing) {
        return;
      }

      const importable = filterImportableFiles(files);
      if (importable.length === 0) {
        resetDragState();
        return;
      }

      setImportError(null);
      const destination = folderPath;
      const generation = generationRef.current;

      try {
        const preview = await previewFileImport(
          destination,
          importable.map((file) => file.name),
        );
        if (generation !== generationRef.current) {
          resetDragState();
          return;
        }
        const allowed = new Set(preview.importable);
        const allowedFiles = importable.filter((file) => allowed.has(file.name));

        if (allowedFiles.length === 0) {
          resetDragState();
          return;
        }

        if (preview.conflicts.length > 0) {
          pendingRef.current = { folderPath: destination, files: allowedFiles };
          setOverwritePrompt({ conflicts: preview.conflicts });
          resetDragState();
          return;
        }

        await runImport(destination, allowedFiles, false);
      } catch (error) {
        setImportError(formatApiError(error));
        resetDragState();
      }
    },
    [enabled, folderPath, importing, resetDragState, runImport],
  );

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || importing) {
        return;
      }

      if (!isExternalFileDrag(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [enabled, importing],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || importing) {
        return;
      }

      if (!isExternalFileDrag(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setIsDragActive(true);
    },
    [enabled, importing],
  );

  const onDragLeave = useCallback(
    (event: DragEvent) => {
      if (!enabled || importing) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragActive(false);
      }
    },
    [enabled, importing],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!enabled || importing) {
        return;
      }

      if (!isExternalFileDrag(event.dataTransfer)) {
        resetDragState();
        return;
      }

      event.preventDefault();
      resetDragState();
      void beginImport(Array.from(event.dataTransfer.files));
    },
    [beginImport, enabled, importing, resetDragState],
  );

  const confirmOverwrite = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) void runImport(pending.folderPath, pending.files, true);
  }, [runImport]);

  const importNewFilesOnly = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) void runImport(pending.folderPath, pending.files, false);
  }, [runImport]);

  const dismissOverwritePrompt = useCallback(() => {
    pendingRef.current = null;
    setOverwritePrompt(null);
  }, []);

  const dismissImportError = useCallback(() => {
    setImportError(null);
  }, []);

  return {
    isDragActive,
    importing,
    importError,
    overwritePrompt,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    confirmOverwrite,
    importNewFilesOnly,
    dismissOverwritePrompt,
    dismissImportError,
  };
}
