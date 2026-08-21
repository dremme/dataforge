import { useCallback, useEffect, useRef, useState } from "react";
import { convertGifToMp4, fetchGifToMp4State } from "@/features/gallery/api/gifToMp4";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

export interface UseGifToMp4Options {
  item: GalleryItem | undefined;
  /** Runs once the MP4 is on disk, so the owner can reload the folder. */
  onConverted?: () => void | Promise<void>;
}

export interface GifToMp4Conversion {
  converting: boolean;
  /** The MP4 name waiting on a replace decision, or null when nothing is in the way. */
  conflict: string | null;
  convert: () => void;
  confirmOverwrite: () => void;
  cancelOverwrite: () => void;
}

/**
 * Writing the viewed GIF out as an MP4 beside itself.
 *
 * Two requests rather than one: the name the MP4 would take is checked first, so a file
 * already holding it becomes a prompt instead of a silent overwrite. Only the answer to
 * that prompt sends `overwrite`, and the server re-checks either way - this decides what
 * the user is asked, never what the server allows.
 */
export function useGifToMp4(options: UseGifToMp4Options): GifToMp4Conversion {
  const notify = useNotify();

  // Read through a ref so the returned callbacks are dependency-free, and so a
  // conversion that outlives an item swap still finishes against what it started with.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const [converting, setConverting] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  // The re-entrancy guard reads a ref: a double click lands before `converting` state
  // has re-rendered the button into its disabled form.
  const convertingRef = useRef(false);
  /** The GIF the open prompt is about, so confirming cannot retarget after a swap. */
  const conflictSourceRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The prompt belongs to the item that raised it. `converting` is deliberately absent:
  // a conversion in flight against the previous item runs its own `finally`, and
  // clearing the flag here would race it.
  useEffect(() => {
    conflictSourceRef.current = null;
    setConflict(null);
  }, [options.item?.path]);

  const start = useCallback(
    (sourcePath: string, overwrite: boolean) => {
      if (convertingRef.current) return;

      convertingRef.current = true;
      setConverting(true);

      void (async () => {
        try {
          if (!overwrite) {
            const state = await fetchGifToMp4State(sourcePath);
            if (state.target_exists) {
              conflictSourceRef.current = sourcePath;
              if (mountedRef.current) setConflict(pathBaseName(state.target));
              return;
            }
          }

          const result = await convertGifToMp4(sourcePath, overwrite);
          notify({
            variant: "success",
            message: `Saved ${pathBaseName(result.path)} at ${result.frame_rate} fps.`,
          });
          await optionsRef.current.onConverted?.();
        } catch (error) {
          // Unguarded by `mountedRef`: the notification store outlives this modal, so a
          // conversion that finishes after a close still reports.
          notify({
            variant: "danger",
            message: `Could not convert ${pathBaseName(sourcePath)}: ${formatApiError(error)}`,
          });
        } finally {
          convertingRef.current = false;
          if (mountedRef.current) setConverting(false);
        }
      })();
    },
    [notify],
  );

  const convert = useCallback(() => {
    const current = optionsRef.current.item;
    if (!current) return;

    start(current.path, false);
  }, [start]);

  const confirmOverwrite = useCallback(() => {
    const sourcePath = conflictSourceRef.current;
    conflictSourceRef.current = null;
    setConflict(null);
    if (!sourcePath) return;

    start(sourcePath, true);
  }, [start]);

  const cancelOverwrite = useCallback(() => {
    conflictSourceRef.current = null;
    setConflict(null);
  }, []);

  return { converting, conflict, convert, confirmOverwrite, cancelOverwrite };
}
