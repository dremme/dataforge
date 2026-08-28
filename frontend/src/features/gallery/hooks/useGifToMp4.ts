import { useCallback, useEffect, useRef, useState } from "react";
import { convertGifToMp4, fetchGifToMp4State } from "@/features/gallery/api/gifToMp4";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { formatApiError } from "@/shared/api/http";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryItem } from "@/shared/types";

export interface UseGifToMp4Options {
  item: GalleryItem | undefined;
  onConverted?: () => void | Promise<void>;
}

export interface GifToMp4Conversion {
  converting: boolean;
  conflict: string | null;
  convert: () => void;
  confirmOverwrite: () => void;
  cancelOverwrite: () => void;
}

export function useGifToMp4(options: UseGifToMp4Options): GifToMp4Conversion {
  const notify = useNotify();

  // Ref so callbacks stay dependency-free; a conversion outliving a swap keeps its values.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const [converting, setConverting] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  // Ref guard: a double click lands before converting has re-rendered the button disabled.
  const convertingRef = useRef(false);
  const conflictSourceRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Prompt belongs to the item that raised it; a conversion in flight runs its own finally.
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
              if (optionsRef.current.item?.path !== sourcePath) return;
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
          // Unguarded by mountedRef: the store outlives this modal, so a finish after close reports.
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
