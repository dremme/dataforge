import { useEffect, useMemo, useRef, useState } from "react";
import { audioProxyUrl, prepareAudioProxy } from "@/shared/api/audioProxy";
import { isAbortError } from "@/shared/api/http";
import { audioProxyKey, type SourceLocation } from "@/features/videoEditor/lib/previewEngine";
import type { Project } from "@/features/videoEditor/lib/timeline";

/** Settling time after a strength changes: a dragged slider would start a render per step. */
const PREPARE_DEBOUNCE_MS = 400;

interface Wanted {
  key: string;
  path: string;
  version: string;
  strength: number;
}

export interface AudioProxies {
  /** Ready proxies by `audioProxyKey`, for the preview engine. */
  ready: ReadonlyMap<string, string>;
  /** Sound clips still playing their source while their proxy renders. */
  preparing: ReadonlySet<string>;
}

/**
 * Renders the noise-reduced proxies the project's sound clips ask for. The export reads the same
 * proxies, so the preview plays what the file will hold.
 */
export function useAudioProxies(
  project: Project,
  locations: ReadonlyMap<string, SourceLocation>,
): AudioProxies {
  const [ready, setReady] = useState<ReadonlyMap<string, string>>(() => new Map());
  // A failed proxy leaves its clips on their source; the export reports the problem itself.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Map<string, AbortController>());

  const { wanted, clipsByKey } = useMemo(() => {
    const byKey = new Map<string, Wanted>();
    const clips = new Map<string, string[]>();
    for (const clip of project.clips) {
      const strength = clip.kind === "audio" ? clip.audio_effects.noise_reduction : 0;
      const location = clip.source_id ? locations.get(clip.source_id) : undefined;
      if (strength <= 0 || !location || location.missing) continue;
      const key = audioProxyKey(location, strength);
      byKey.set(key, { key, path: location.path, version: location.version, strength });
      clips.set(key, [...(clips.get(key) ?? []), clip.id]);
    }
    return { wanted: byKey, clipsByKey: clips };
  }, [locations, project.clips]);

  useEffect(() => {
    const pending = pendingRef.current;
    for (const [key, controller] of pending) {
      if (!wanted.has(key)) {
        controller.abort();
        pending.delete(key);
      }
    }
    const missing = [...wanted.values()].filter(
      (entry) => !ready.has(entry.key) && !failed.has(entry.key) && !pending.has(entry.key),
    );
    if (missing.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const entry of missing) {
        const controller = new AbortController();
        pending.set(entry.key, controller);
        const request = {
          path: entry.path,
          noiseReduction: entry.strength,
          pitch: 0,
          original: false,
        };
        void prepareAudioProxy(request, controller.signal)
          .then(() => {
            setReady((current) =>
              new Map(current).set(entry.key, audioProxyUrl(request, entry.version)),
            );
          })
          .catch((error: unknown) => {
            if (!isAbortError(error)) setFailed((current) => new Set(current).add(entry.key));
          })
          .finally(() => {
            if (pending.get(entry.key) === controller) pending.delete(entry.key);
          });
      }
    }, PREPARE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [failed, ready, wanted]);

  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, []);

  const preparing = useMemo(() => {
    const ids = new Set<string>();
    for (const [key, clips] of clipsByKey) {
      if (!ready.has(key) && !failed.has(key)) for (const id of clips) ids.add(id);
    }
    return ids;
  }, [clipsByKey, failed, ready]);

  return { ready, preparing };
}
