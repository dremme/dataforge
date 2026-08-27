import { useCallback, useRef, useState } from "react";
import {
  previewMediaTransfer,
  transferSelectedMedia,
  type MediaTransferMode,
} from "@/features/gallery/api/media";
import { folderLeafName } from "@/features/folder/lib/folderPath";
import { failureMessage } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";

export type MediaTransferPrompt = {
  mode: MediaTransferMode;
  destination: string;
  conflicts: string[];
  paths: string[];
};

export interface UseMediaTransferOptions {
  paths: readonly string[];
  onMoved: (succeeded: string[]) => void | Promise<void>;
  onCopied: () => void | Promise<void>;
  emptyPreviewMessage?: (mode: MediaTransferMode, paths: string[]) => string;
  copySuccessMessage?: (succeeded: string[], destinationLabel: string) => string;
}

function defaultEmptyPreviewMessage(mode: MediaTransferMode): string {
  return `No selected files can be ${mode === "move" ? "moved" : "copied"} to that folder.`;
}

function defaultCopySuccessMessage(succeeded: string[], destinationLabel: string): string {
  const count = succeeded.length === 1 ? "1 file" : `${succeeded.length.toLocaleString()} files`;
  return `Copied ${count} to ${destinationLabel}.`;
}

/** executeTransfer stays unguarded: selectDestination sets transferring before awaiting it. */
export function useMediaTransfer(options: UseMediaTransferOptions) {
  const notify = useNotify();

  // Ref so callbacks stay dependency-free; a flow outliving a swap keeps its starting values.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [transferPicker, setTransferPicker] = useState<MediaTransferMode | null>(null);
  const [overwritePrompt, setOverwritePrompt] = useState<MediaTransferPrompt | null>(null);
  const [transferring, setTransferring] = useState<MediaTransferMode | null>(null);
  const transferringRef = useRef<MediaTransferMode | null>(null);

  const beginTransfer = useCallback((mode: MediaTransferMode) => {
    transferringRef.current = mode;
    setTransferring(mode);
  }, []);

  const endTransfer = useCallback(() => {
    transferringRef.current = null;
    setTransferring(null);
  }, []);

  const openTransferPicker = useCallback((mode: MediaTransferMode) => {
    if (transferringRef.current || optionsRef.current.paths.length === 0) return;
    setTransferPicker(mode);
  }, []);

  const closeTransferPicker = useCallback(() => {
    if (transferringRef.current) return;
    setTransferPicker(null);
  }, []);

  const closeOverwritePrompt = useCallback(() => {
    if (transferringRef.current) return;
    setOverwritePrompt(null);
  }, []);

  const executeTransfer = useCallback(
    async (
      mode: MediaTransferMode,
      destinationFolder: string,
      overwrite: boolean,
      paths: string[],
    ) => {
      const { onMoved, onCopied, copySuccessMessage } = optionsRef.current;

      const { succeeded, failed } = await transferSelectedMedia(
        mode,
        destinationFolder,
        paths,
        overwrite,
      );

      if (succeeded.length > 0) {
        // A move empties the source folder; a copy only changes folder stats.
        await (mode === "move" ? onMoved(succeeded) : onCopied());
      }

      setTransferPicker(null);
      setOverwritePrompt(null);

      // The backend reports per-file failures in its 200 response, so nothing throws here.
      if (failed.length > 0) {
        notify({ variant: "danger", message: failureMessage(mode, failed) });
      }

      if (mode === "copy" && succeeded.length > 0) {
        // Nothing changes in this folder, so say so rather than leaving it silent.
        const target = folderLeafName(destinationFolder) || destinationFolder;
        const message = (copySuccessMessage ?? defaultCopySuccessMessage)(succeeded, target);
        notify({ variant: "success", message });
      }
    },
    [notify],
  );

  const selectDestination = useCallback(
    (mode: MediaTransferMode, destinationFolder: string) => {
      const paths = [...optionsRef.current.paths];
      if (paths.length === 0 || transferringRef.current) return;

      beginTransfer(mode);

      void (async () => {
        try {
          const preview = await previewMediaTransfer(mode, destinationFolder, paths);
          setTransferPicker(null);

          if (preview.eligible.length === 0 && preview.conflicts.length === 0) {
            const message = (optionsRef.current.emptyPreviewMessage ?? defaultEmptyPreviewMessage)(
              mode,
              paths,
            );
            notify({ variant: "warning", message });
            return;
          }

          if (preview.conflicts.length > 0) {
            setOverwritePrompt({
              mode,
              destination: destinationFolder,
              conflicts: preview.conflicts,
              paths,
            });
            return;
          }

          await executeTransfer(mode, destinationFolder, false, paths);
        } catch (error) {
          notify({ variant: "danger", message: formatApiError(error) });
        } finally {
          endTransfer();
        }
      })();
    },
    [beginTransfer, endTransfer, executeTransfer, notify],
  );

  const confirmOverwrite = useCallback(
    (overwrite: boolean) => {
      const prompt = overwritePrompt;
      if (!prompt || transferringRef.current) return;

      beginTransfer(prompt.mode);

      void (async () => {
        try {
          await executeTransfer(prompt.mode, prompt.destination, overwrite, prompt.paths);
        } catch (error) {
          notify({ variant: "danger", message: formatApiError(error) });
        } finally {
          endTransfer();
        }
      })();
    },
    [beginTransfer, endTransfer, executeTransfer, notify, overwritePrompt],
  );

  return {
    transferPicker,
    overwritePrompt,
    transferring,
    transferDialogOpen: transferPicker !== null || overwritePrompt !== null,
    openTransferPicker,
    closeTransferPicker,
    closeOverwritePrompt,
    selectDestination,
    confirmOverwrite,
  };
}
