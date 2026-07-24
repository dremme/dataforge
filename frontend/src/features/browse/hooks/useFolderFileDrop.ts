import { useCallback, useRef, useState, type DragEvent } from "react";
import { importFiles, previewFileImport } from "@/features/browse/api/files";
import { formatApiError } from "@/shared/api/http";
import { isExternalFileDrag } from "@/shared/lib/dragTransfer";
import { filterImportableFiles } from "@/features/browse/lib/importableFiles";

type OverwritePrompt = {
  conflicts: string[];
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
  const pendingFilesRef = useRef<File[]>([]);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }, []);

  const runImport = useCallback(
    async (files: File[], overwrite: boolean) => {
      if (!folderPath || files.length === 0) {
        return;
      }

      setImporting(true);
      setImportError(null);

      try {
        const result = await importFiles(folderPath, files, overwrite);
        if (result.copied.length > 0) {
          await onImported();
        }
      } catch (error) {
        setImportError(formatApiError(error));
      } finally {
        setImporting(false);
        pendingFilesRef.current = [];
        setOverwritePrompt(null);
        resetDragState();
      }
    },
    [folderPath, onImported, resetDragState],
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

      try {
        const preview = await previewFileImport(
          folderPath,
          importable.map((file) => file.name),
        );
        const allowed = new Set(preview.importable);
        const allowedFiles = importable.filter((file) => allowed.has(file.name));

        if (allowedFiles.length === 0) {
          resetDragState();
          return;
        }

        if (preview.conflicts.length > 0) {
          pendingFilesRef.current = allowedFiles;
          setOverwritePrompt({ conflicts: preview.conflicts });
          resetDragState();
          return;
        }

        await runImport(allowedFiles, false);
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
    void runImport(pendingFilesRef.current, true);
  }, [runImport]);

  const importNewFilesOnly = useCallback(() => {
    void runImport(pendingFilesRef.current, false);
  }, [runImport]);

  const dismissOverwritePrompt = useCallback(() => {
    pendingFilesRef.current = [];
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
