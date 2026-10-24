import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  applyAudioEdit,
  audioOriginalUrl,
  cancelAudioEdit,
  fetchAudioEditState,
  measureAudioLoudness,
  revertAudioEdit,
} from "@/features/gallery/api/audioEdit";
import { audioProxyUrl, prepareAudioProxy } from "@/shared/api/audioProxy";
import {
  AUDIO_TRIM_STEP,
  audioDraftFromSpec,
  audioOutputDuration,
  audioSpecsEqual,
  emptyAudioDraft,
  fadeGainAt,
  fittedFades,
  isIdentityAudioEdit,
  loudnessKey,
  toAudioEditSpec,
  type AudioEditDraft,
} from "@/features/gallery/lib/audioEdit";
import { snapTrimEnd, snapTrimStart, trimForLength } from "@/features/gallery/lib/videoEdit";
import { useVideoPreviewPlayback } from "@/features/gallery/hooks/useVideoPreviewPlayback";
import { formatFrameTime, hasUsableDuration } from "@/features/gallery/lib/videoFrameCapture";
import { VIDEO_PROJECT_LOUDNESS_TARGET_LUFS } from "@/shared/constants";
import { formatApiError, isAbortError } from "@/shared/api/http";
import { useServerEvent } from "@/shared/events/serverEvents";
import { useNotify } from "@/shared/notifications/notifications";
import { replacedExternallyMessage } from "@/features/gallery/lib/mediaActionMessages";
import { createEffectsChain, type EffectsChain } from "@/shared/lib/audioEffects";
import type { AudioEditSpec, AudioEffects, AudioLevel, GalleryItem } from "@/shared/types";
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import { useChanged } from "@/shared/hooks/useChanged";

/** Settling time before a proxy render or a loudness measurement starts after a change. */
const PREVIEW_DEBOUNCE_MS = 400;

export interface UseAudioEditOptions {
  item: GalleryItem | undefined;
  audioRef: RefObject<HTMLAudioElement | null>;
  onEdited?: () => void | Promise<void>;
  /** Owned by the dialog so the mode sticks across next/prev. */
  editMode: boolean;
  setEditMode: (editMode: boolean) => void;
}

export interface AudioEdit {
  editMode: boolean;
  ready: boolean;
  applying: boolean;
  /** Null when the output length could not be predicted. */
  progress: number | null;
  draft: AudioEditDraft;
  duration: number;
  hasBackup: boolean;
  dirty: boolean;
  playing: boolean;
  playheadTime: number;
  playheadRef: RefObject<HTMLDivElement | null>;
  outputSeconds: number;
  /** Noise reduction or pitch is being rendered for the preview; it plays the last one till then. */
  preparingPreview: boolean;
  previewError: string | null;
  /** The normalize gain is being measured; the preview plays without it till then. */
  measuring: boolean;
  /** No Web Audio: the preview can neither boost nor shape the sound. */
  previewLimited: boolean;
  /** EditActions reads it; the audio edit has no wand. */
  adjust: { autoPending: false };
  toggleEditMode: () => void;
  exitEditMode: () => void;
  setTrimStart: (seconds: number) => void;
  setTrimEnd: (seconds: number) => void;
  setTrimStartAtPlayhead: () => void;
  setTrimEndAtPlayhead: () => void;
  setTrimLength: (seconds: number) => void;
  setFadeIn: (seconds: number) => void;
  setFadeOut: (seconds: number) => void;
  setFadeCurve: (curve: AudioEditDraft["fadeCurve"]) => void;
  setVolume: (volume: number) => void;
  setLevel: (level: AudioLevel) => void;
  setSpeed: (speed: number) => void;
  setPitch: (semitones: number) => void;
  setEffects: (change: Partial<AudioEffects>) => void;
  seekTo: (seconds: number) => void;
  togglePlay: () => void;
  resetDraft: () => void;
  apply: () => void;
  cancel: () => void;
  revert: () => void;
  handleLoadedMetadata: (audio: HTMLAudioElement) => void;
}

interface PreviewGraph {
  context: AudioContext;
  element: HTMLMediaElement;
  source: MediaElementAudioSourceNode;
  chain: EffectsChain;
  gain: GainNode;
}

interface ReadyProxy {
  key: string;
  url: string;
}

function proxyKey(draft: AudioEditDraft): string | null {
  const noise = draft.effects.noise_reduction;
  if (noise <= 0 && draft.pitch === 0) return null;
  return `${noise.toFixed(4)}|${draft.pitch}`;
}

export function useAudioEdit(options: UseAudioEditOptions): AudioEdit {
  const notify = useNotify();
  const { item, audioRef, editMode, setEditMode } = options;
  const optionsRef = useLatestRef(options);
  const path = item?.path;

  const mountedRef = useRef(true);
  const applyingRef = useRef(false);
  const [duration, setDuration] = useState(Number.NaN);
  const [draft, setDraft] = useState<AudioEditDraft>(() => emptyAudioDraft(Number.NaN));
  const [savedSpec, setSavedSpec] = useState<AudioEditSpec | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // The saved spec has been read for this path; editing before then would apply a draft missing it.
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [proxy, setProxy] = useState<ReadyProxy | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loudness, setLoudness] = useState<{ key: string; lufs: number | null } | null>(null);
  const [previewLimited, setPreviewLimited] = useState(false);

  const draftRef = useLatestRef(draft);
  const durationRef = useLatestRef(duration);
  const savedSpecRef = useLatestRef(savedSpec);
  const seededPathRef = useRef<string | null>(null);
  const graphRef = useRef<PreviewGraph | null>(null);

  const ready = hasUsableDuration(duration) && loadedPath === path;
  const readyRef = useLatestRef(ready);

  const getRange = useCallback(
    () => ({ start: draftRef.current.trimStart, end: draftRef.current.trimEnd }),
    [draftRef],
  );
  const playback = useVideoPreviewPlayback<HTMLAudioElement>({
    videoRef: audioRef,
    active: editMode,
    itemPath: path,
    duration,
    frameDuration: AUDIO_TRIM_STEP,
    getRange,
  });
  const { playing, playheadTime, playheadRef, seekTo } = playback;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void graphRef.current?.context.close().catch(() => undefined);
      graphRef.current = null;
    };
  }, []);

  const editModeChanged = useChanged(editMode);
  const pathChanged = useChanged(path);
  if (editModeChanged || pathChanged) {
    setDuration(Number.NaN);
    setDraft(emptyAudioDraft(Number.NaN));
    setSavedSpec(null);
    setLoadedPath(null);
    setProxy(null);
    setPreviewError(null);
    setLoudness(null);
  }
  const listedBackupChanged = useChanged(item?.has_backup);
  if (pathChanged || listedBackupChanged) setHasBackup(item?.has_backup ?? false);

  useServerEvent((event) => {
    if (event.type !== "audio_edit") return;
    if (event.path !== optionsRef.current.item?.path) return;
    setProgress(
      event.duration && event.duration > 0
        ? Math.min(1, Math.max(0, event.seconds / event.duration))
        : null,
    );
  });

  const seedDraft = useCallback(
    (spec: AudioEditSpec | null, forDuration: number) => {
      const seeded = audioDraftFromSpec(spec, forDuration);
      setDraft(seeded);
      seekTo(seeded.trimStart);
    },
    [seekTo],
  );

  // The spec and the original's length come from the server; the element fills in a length it
  // could not read.
  useEffect(() => {
    if (!editMode || !path) {
      seededPathRef.current = null;
      return;
    }
    if (seededPathRef.current === path) return;
    seededPathRef.current = path;
    const forPath = path;
    void (async () => {
      try {
        const state = await fetchAudioEditState(forPath);
        if (!mountedRef.current || optionsRef.current.item?.path !== forPath) return;
        setHasBackup(state.has_backup);
        setSavedSpec(state.spec ?? null);
        if (state.duration != null && state.duration > 0) setDuration(state.duration);
      } catch {
        // Unreadable state: open on an empty draft like an unedited file.
      }
      if (mountedRef.current && optionsRef.current.item?.path === forPath) setLoadedPath(forPath);
    })();
  }, [editMode, optionsRef, path]);

  // Seeded once both the spec and a length are in, whichever arrives last.
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editMode) {
      seededForRef.current = null;
      return;
    }
    if (!ready || !path || seededForRef.current === path) return;
    seededForRef.current = path;
    seedDraft(savedSpecRef.current, durationRef.current);
  }, [durationRef, editMode, path, ready, savedSpecRef, seedDraft]);

  const handleLoadedMetadata = useCallback(
    (audio: HTMLAudioElement) => {
      if (!hasUsableDuration(durationRef.current) && hasUsableDuration(audio.duration)) {
        setDuration(audio.duration);
      }
    },
    [durationRef],
  );

  // Noise reduction and pitch: rendered by the server, then played in place of the original.
  const wantedProxy = proxyKey(draft);
  useEffect(() => {
    if (!editMode || !path || wantedProxy === null) return;
    if (proxy?.key === wantedProxy) return;
    const request = {
      path,
      noiseReduction: draftRef.current.effects.noise_reduction,
      pitch: draftRef.current.pitch,
      original: true,
    };
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void prepareAudioProxy(request, controller.signal)
        .then(() => {
          if (!mountedRef.current) return;
          setPreviewError(null);
          setProxy({ key: wantedProxy, url: audioProxyUrl(request) });
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || !mountedRef.current) return;
          setPreviewError(formatApiError(error));
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draftRef, editMode, path, proxy?.key, wantedProxy]);

  const sourceUrl = !path
    ? null
    : wantedProxy !== null && proxy
      ? proxy.url
      : audioOriginalUrl(path);

  // Swapped in place, at the same moment, so a proxy arriving mid-listen does not jump.
  useEffect(() => {
    const element = audioRef.current;
    if (!editMode || !element || !sourceUrl || element.dataset.url === sourceUrl) return;
    const resumeAt = element.dataset.url ? element.currentTime : null;
    const resumePlaying = !element.paused;
    element.dataset.url = sourceUrl;
    element.src = sourceUrl;
    if (resumeAt === null) return;
    const restore = () => {
      element.currentTime = resumeAt;
      if (resumePlaying) void element.play().catch(() => undefined);
    };
    element.addEventListener("loadedmetadata", restore, { once: true });
    return () => element.removeEventListener("loadedmetadata", restore);
  }, [audioRef, editMode, path, sourceUrl]);

  // A normalize plays at the gain the render will use, measured on the server.
  const spec = toAudioEditSpec(draft, duration);
  const measuredKey =
    draft.level === "normalize" && ready ? JSON.stringify(loudnessKey(spec)) : null;
  useEffect(() => {
    if (!path || measuredKey === null || loudness?.key === measuredKey) return;
    const controller = new AbortController();
    const body = JSON.parse(measuredKey) as AudioEditSpec;
    const timer = window.setTimeout(() => {
      void measureAudioLoudness(path, body, controller.signal)
        .then((result) => {
          if (mountedRef.current) setLoudness({ key: measuredKey, lufs: result.integrated_lufs });
        })
        .catch((error: unknown) => {
          if (!isAbortError(error) && mountedRef.current) setPreviewError(formatApiError(error));
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loudness?.key, measuredKey, path]);

  const normalizeGain =
    measuredKey !== null && loudness?.key === measuredKey && loudness.lufs !== null
      ? 10 ** ((VIDEO_PROJECT_LOUDNESS_TARGET_LUFS - loudness.lufs) / 20)
      : 1;
  const normalizeGainRef = useLatestRef(normalizeGain);

  // Built on the first play, inside its gesture: a context made earlier starts suspended and
  // would silence the element it takes over.
  const ensureGraph = useCallback((): PreviewGraph | null => {
    const element = audioRef.current;
    if (!element) return null;
    const current = graphRef.current;
    if (current?.element === element) return current;
    if (typeof AudioContext === "undefined") {
      setPreviewLimited(true);
      return null;
    }
    try {
      const context = current?.context ?? new AudioContext();
      if (current) {
        current.source.disconnect();
        current.chain.disconnect();
        current.gain.disconnect();
      }
      const source = context.createMediaElementSource(element);
      const chain = createEffectsChain(context);
      const gain = context.createGain();
      source.connect(chain.input);
      chain.output.connect(gain).connect(context.destination);
      chain.update(draftRef.current.effects);
      graphRef.current = { context, element, source, chain, gain };
      return graphRef.current;
    } catch {
      setPreviewLimited(true);
      return null;
    }
  }, [audioRef, draftRef]);

  // Volume, fades and the normalize gain as one level, kept current while playing.
  const syncLevel = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    const current = draftRef.current;
    const level =
      current.volume * fadeGainAt(current, element.currentTime) * normalizeGainRef.current;
    const graph = graphRef.current;
    if (graph?.element === element) {
      graph.gain.gain.value = level;
      element.volume = 1;
    } else {
      element.volume = Math.min(1, Math.max(0, level));
    }
  }, [audioRef, draftRef, normalizeGainRef]);

  useEffect(() => {
    if (!editMode) return;
    syncLevel();
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      syncLevel();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft, editMode, normalizeGain, playheadTime, playing, syncLevel]);

  useEffect(() => {
    graphRef.current?.chain.update(draft.effects);
  }, [draft.effects]);

  useEffect(() => {
    const element = audioRef.current;
    if (!editMode || !element) return;
    element.preservesPitch = true;
    element.playbackRate = draft.speed;
  }, [audioRef, draft.speed, editMode, path, sourceUrl]);

  const togglePlay = useCallback(() => {
    const graph = ensureGraph();
    if (graph && graph.context.state === "suspended") void graph.context.resume();
    syncLevel();
    playback.togglePlay();
  }, [ensureGraph, playback, syncLevel]);

  const update = useCallback((change: (current: AudioEditDraft) => AudioEditDraft) => {
    setDraft((current) => fittedFades(change(current)));
  }, []);

  const setTrimStart = useCallback(
    (seconds: number) => {
      const next = snapTrimStart(seconds, draftRef.current, durationRef.current, AUDIO_TRIM_STEP);
      update((current) => ({ ...current, trimStart: next }));
      seekTo(next);
    },
    [draftRef, durationRef, seekTo, update],
  );

  const setTrimEnd = useCallback(
    (seconds: number) => {
      const next = snapTrimEnd(seconds, draftRef.current, durationRef.current, AUDIO_TRIM_STEP);
      update((current) => ({ ...current, trimEnd: next }));
      seekTo(Math.max(draftRef.current.trimStart, next - 1));
    },
    [draftRef, durationRef, seekTo, update],
  );

  const setTrimStartAtPlayhead = useCallback(() => {
    const element = audioRef.current;
    if (element) setTrimStart(element.currentTime);
  }, [audioRef, setTrimStart]);

  const setTrimEndAtPlayhead = useCallback(() => {
    const element = audioRef.current;
    if (element) setTrimEnd(element.currentTime);
  }, [audioRef, setTrimEnd]);

  const setTrimLength = useCallback(
    (seconds: number) => {
      const range = trimForLength(seconds, draftRef.current, durationRef.current, AUDIO_TRIM_STEP);
      if (!range) return;
      update((current) => ({ ...current, ...range }));
      seekTo(range.trimStart);
    },
    [draftRef, durationRef, seekTo, update],
  );

  const field = useCallback(
    <Key extends keyof AudioEditDraft>(key: Key) =>
      (value: AudioEditDraft[Key]) =>
        update((current) => ({ ...current, [key]: value })),
    [update],
  );
  // Fades fit the output: one fade gives way to the other only as far as the length needs.
  const setFadeIn = useCallback(
    (seconds: number) =>
      update((current) => {
        const length = audioOutputDuration(current);
        const fadeIn = Math.min(seconds, length);
        return { ...current, fadeIn, fadeOut: Math.min(current.fadeOut, length - fadeIn) };
      }),
    [update],
  );
  const setFadeOut = useCallback(
    (seconds: number) =>
      update((current) => {
        const length = audioOutputDuration(current);
        const fadeOut = Math.min(seconds, length);
        return { ...current, fadeOut, fadeIn: Math.min(current.fadeIn, length - fadeOut) };
      }),
    [update],
  );
  const setEffects = useCallback(
    (change: Partial<AudioEffects>) =>
      update((current) => ({ ...current, effects: { ...current.effects, ...change } })),
    [update],
  );

  const resetDraft = useCallback(() => {
    seedDraft(savedSpecRef.current, durationRef.current);
  }, [durationRef, savedSpecRef, seedDraft]);

  const exitEditMode = useCallback(() => {
    audioRef.current?.pause();
    setEditMode(false);
  }, [audioRef, setEditMode]);

  const toggleEditMode = useCallback(() => {
    if (applyingRef.current) return;
    if (editMode) {
      exitEditMode();
      return;
    }
    audioRef.current?.pause();
    setEditMode(true);
  }, [audioRef, editMode, exitEditMode, setEditMode]);

  const runEdit = useCallback(
    (
      request: (path: string) => Promise<{ has_backup: boolean; replaced_externally: boolean }>,
      describe: (name: string) => string,
      settle: () => void,
    ) => {
      if (applyingRef.current || !readyRef.current) return;
      const currentItem = optionsRef.current.item;
      if (!currentItem) return;
      // Snapshotted so an item swap mid-render cannot retarget the write.
      const mediaPath = currentItem.path;
      const name = currentItem.name;

      audioRef.current?.pause();
      applyingRef.current = true;
      setApplying(true);
      setProgress(null);

      void (async () => {
        try {
          const result = await request(mediaPath);
          if (mountedRef.current) setHasBackup(result.has_backup);
          notify({ variant: "success", message: describe(name) });
          if (result.replaced_externally) {
            notify({ variant: "warning", message: replacedExternallyMessage(name) });
          }
          await optionsRef.current.onEdited?.();
          if (mountedRef.current) settle();
        } catch (error) {
          notify({
            variant: "danger",
            message: `Could not edit ${name}: ${formatApiError(error)}`,
          });
        } finally {
          applyingRef.current = false;
          if (mountedRef.current) {
            setApplying(false);
            setProgress(null);
          }
        }
      })();
    },
    [audioRef, notify, optionsRef, readyRef],
  );

  const revert = useCallback(() => {
    runEdit(
      revertAudioEdit,
      (name) => `Restored the original ${name}.`,
      () => {
        setSavedSpec(null);
        seedDraft(null, durationRef.current);
      },
    );
  }, [durationRef, runEdit, seedDraft]);

  const apply = useCallback(() => {
    const currentDraft = draftRef.current;
    const currentDuration = durationRef.current;
    // An identity draft restores the backup instead of re-encoding.
    if (isIdentityAudioEdit(currentDraft, currentDuration)) {
      revert();
      return;
    }
    const next = toAudioEditSpec(currentDraft, currentDuration);
    const seconds = audioOutputDuration(currentDraft);
    runEdit(
      (mediaPath) => applyAudioEdit(mediaPath, next),
      (name) => `Edited ${name} - ${formatFrameTime(seconds)} long.`,
      () => setSavedSpec(next),
    );
  }, [draftRef, durationRef, revert, runEdit]);

  const cancel = useCallback(() => {
    const currentItem = optionsRef.current.item;
    if (!currentItem || !applyingRef.current) return;
    void cancelAudioEdit(currentItem.path);
  }, [optionsRef]);

  const dirty =
    ready &&
    (savedSpec === null
      ? !isIdentityAudioEdit(draft, duration)
      : !audioSpecsEqual(spec, savedSpec));

  return {
    editMode,
    ready,
    applying,
    progress,
    draft,
    duration,
    hasBackup,
    dirty,
    playing,
    playheadTime,
    playheadRef,
    outputSeconds: audioOutputDuration(draft),
    preparingPreview: wantedProxy !== null && proxy?.key !== wantedProxy && previewError === null,
    previewError,
    measuring: measuredKey !== null && loudness?.key !== measuredKey && previewError === null,
    previewLimited,
    adjust: { autoPending: false },
    toggleEditMode,
    exitEditMode,
    setTrimStart,
    setTrimEnd,
    setTrimStartAtPlayhead,
    setTrimEndAtPlayhead,
    setTrimLength,
    setFadeIn,
    setFadeOut,
    setFadeCurve: field("fadeCurve"),
    setVolume: field("volume"),
    setLevel: field("level"),
    setSpeed: field("speed"),
    setPitch: field("pitch"),
    setEffects,
    seekTo,
    togglePlay,
    resetDraft,
    apply,
    cancel,
    revert,
    handleLoadedMetadata,
  };
}
