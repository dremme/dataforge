import { ADJUST_PREVIEW_LUT_SIZE } from "@/shared/constants";
import { AdjustRenderer } from "@/features/gallery/lib/adjustRenderer";
import {
  buildAdjustLut,
  isAdjustIdentity,
  isGlobalIdentity,
} from "@/features/gallery/lib/colorAdjust";
import { mediaUrl } from "@/features/gallery/api/media";
import { titleImageUrl } from "@/features/videoEditor/api/videoProjects";
import {
  layersAt,
  pictureTime,
  placement,
  sourceTimeAt,
  transitionFades,
  voicesAt,
  type Layer,
} from "./composition";
import { clipEnd, projectDuration, sourceById, type Clip, type Project } from "./timeline";

/** Drift a playing element may build up before it is put back on the clock. */
const PLAYING_DRIFT_SECONDS = 0.12;
/** How early an upcoming clip is cued, so the cut does not wait for a seek. */
const CUE_AHEAD_SECONDS = 1.5;
/** Elements kept for clips this far from the playhead are released. */
const KEEP_AROUND_SECONDS = 8;
/** The colour-adjusted copy of a clip is drawn no wider than this. */
export const MAX_ADJUST_WIDTH = 960;
/** A video that has shown no picture this long after it was asked for is reported as stuck. */
export const MEDIA_STALL_MS = 15000;
/** Samples per meter reading: about 21 ms at 48 kHz, short enough to catch a transient. */
const METER_WINDOW = 1024;

export type MediaProblemKind = "unsupported" | "decode" | "network" | "stalled" | "no-picture";

/** A source the browser could not play, named so the person knows what to do about it. */
export interface MediaProblem {
  sourceId: string;
  kind: MediaProblemKind;
}

/** What the timeline monitor is not showing exactly as the export will draw it. */
export interface PreviewFidelity {
  /** Color adjustments could not be drawn here, so adjusted clips show their original colors. */
  adjustUnavailable: boolean;
  /** An adjusted clip is drawn from a copy narrower than its source. */
  adjustReduced: boolean;
}

/** Peak sample magnitude of each channel of the preview's mix; 1 is full scale. */
export interface MeterReading {
  left: number;
  right: number;
}

/** Short words for the monitor's placeholder box; the panel explains each one in full. */
export const MEDIA_PROBLEM_LABELS: Record<MediaProblemKind, string> = {
  unsupported: "Format not supported",
  decode: "Cannot decode",
  network: "Cannot read file",
  stalled: "Not loading",
  "no-picture": "No picture",
};

/** ``MediaError`` codes, spelled out: the constructor is missing outside browsers. */
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;

export function problemFromError(error: Pick<MediaError, "code"> | null): MediaProblemKind {
  if (error?.code === MEDIA_ERR_NETWORK) return "network";
  if (error?.code === MEDIA_ERR_DECODE) return "decode";
  return "unsupported";
}

export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

const RESTING_FIDELITY: PreviewFidelity = { adjustUnavailable: false, adjustReduced: false };

export interface SourceLocation {
  path: string;
  /** Changes when the file does, so a relinked or accepted source is not served from cache. */
  version: string;
  missing: boolean;
}

export type EngineListener = (time: number) => void;

interface AdjustSlot {
  canvas: HTMLCanvasElement;
  staging: HTMLCanvasElement;
  renderer: AdjustRenderer | null;
  key: string;
}

/**
 * Plays a project into one canvas. The clock is the wall clock while every visible clip is ready,
 * and holds while one is still loading, so sound and picture never drift apart around a cut.
 * Each clip owns its media element: two clips of one file can show at once in a dissolve.
 */
export class PreviewEngine {
  private project: Project | null = null;
  private sources = new Map<string, SourceLocation>();
  private canvas: HTMLCanvasElement | null = null;
  private videos = new Map<string, HTMLVideoElement>();
  private audios = new Map<string, HTMLAudioElement>();
  private gains = new Map<string, GainNode>();
  private images = new Map<string, HTMLImageElement>();
  private adjusters = new Map<string, AdjustSlot>();
  private audioContext: AudioContext | null = null;
  private master: GainNode | null = null;
  private meters: [AnalyserNode, AnalyserNode] | null = null;
  private meterBuffer = new Float32Array(METER_WINDOW);
  /** Keyed by media URL, so relinking or accepting a changed file starts it afresh. */
  private failures = new Map<string, MediaProblemKind>();
  private problems: MediaProblem[] = [];
  private fidelity: PreviewFidelity = RESTING_FIDELITY;
  private listeners = new Set<EngineListener>();
  private stateListeners = new Set<() => void>();
  private frameRequest = 0;
  private clockStart = 0;
  private wallStart = 0;
  private time = 0;
  private playing = false;
  private waiting = false;

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.render();
  }

  setProject(project: Project, sources: Map<string, SourceLocation>): void {
    this.project = project;
    this.sources = sources;
    const live = new Set(project.clips.map((clip) => clip.id));
    for (const [id, element] of this.videos)
      if (!live.has(id)) this.release(this.videos, id, element);
    for (const [id, element] of this.audios)
      if (!live.has(id)) this.release(this.audios, id, element);
    if (this.time > this.duration) this.time = this.duration;
    this.updateProblems();
    this.sync();
    this.render();
  }

  get duration(): number {
    return this.project ? projectDuration(this.project) : 0;
  }

  get currentTime(): number {
    return this.time;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** True while playback holds for a clip that is not ready to show. */
  get isWaiting(): boolean {
    return this.waiting;
  }

  /** Sources the browser failed to play; the same array until the set changes. */
  get mediaProblems(): MediaProblem[] {
    return this.problems;
  }

  /** The same object until a reading changes. */
  get previewFidelity(): PreviewFidelity {
    return this.fidelity;
  }

  /** The mix's peaks since the last reading's window; null until playback has started sound. */
  readMeter(): MeterReading | null {
    if (!this.meters) return null;
    const [left, right] = this.meters.map((meter) => {
      meter.getFloatTimeDomainData(this.meterBuffer);
      return peakOf(this.meterBuffer);
    });
    return { left, right };
  }

  /** Loads a failed source again, e.g. after it was converted or the server came back. */
  retry(sourceId: string): void {
    const location = this.sources.get(sourceId);
    if (!location) return;
    const url = mediaUrl(location.path, location.version);
    this.failures.delete(url);
    for (const pool of [this.videos, this.audios] as Map<string, HTMLMediaElement>[]) {
      for (const [id, element] of pool)
        if (element.dataset.url === url) this.release(pool, id, element);
    }
    this.updateProblems();
    this.sync();
    this.render();
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  seek(time: number): void {
    this.time = Math.max(0, Math.min(time, this.duration));
    this.clockStart = this.time;
    this.wallStart = performance.now();
    this.sync();
    this.render();
    this.emit();
  }

  play(): void {
    if (this.playing || !this.project) return;
    if (this.time >= this.duration - 1e-3) this.time = 0;
    this.ensureAudioContext();
    this.playing = true;
    this.clockStart = this.time;
    this.wallStart = performance.now();
    this.sync();
    this.emitState();
    this.loop();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.waiting = false;
    // A paused playhead sits on a frame, so stepping and cutting start from one, but never past
    // the end: rounding there can land on a frame the project does not reach. One that ran to the
    // end stays there, or rounding down from it would leave `play` nothing to rewind from.
    if (this.project && this.time < this.duration) {
      const frame = Math.round(this.time * this.project.frame_rate) / this.project.frame_rate;
      this.time = Math.min(frame, this.duration);
    }
    cancelAnimationFrame(this.frameRequest);
    this.sync();
    this.render();
    this.emitState();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Releases media and audio; StrictMode may keep using the engine afterwards, and can. */
  dispose(): void {
    this.pause();
    for (const [id, element] of this.videos) this.release(this.videos, id, element);
    for (const [id, element] of this.audios) this.release(this.audios, id, element);
    for (const slot of this.adjusters.values()) slot.renderer?.dispose();
    this.adjusters.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.master = null;
    this.meters = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.time);
  }

  private emitState(): void {
    for (const listener of this.stateListeners) listener();
  }

  private loop = (): void => {
    if (!this.playing) return;
    const ready = this.activeVideosReady();
    if (ready) {
      if (this.waiting) {
        // Pick the clock up from where it held, not from where the wall clock ran to.
        this.clockStart = this.time;
        this.wallStart = performance.now();
      }
      this.time = this.clockStart + (performance.now() - this.wallStart) / 1000;
    } else {
      this.clockStart = this.time;
      this.wallStart = performance.now();
    }
    if (this.waiting === ready) {
      this.waiting = !ready;
      this.emitState();
    }
    if (this.time >= this.duration) {
      this.time = this.duration;
      this.pause();
      return;
    }
    this.sync();
    this.render();
    this.emit();
    this.frameRequest = requestAnimationFrame(this.loop);
  };

  private activeVideosReady(): boolean {
    if (!this.project) return true;
    for (const layer of layersAt(this.project, pictureTime(this.project, this.time))) {
      if (layer.clip.kind !== "video") continue;
      const element = this.videos.get(layer.clip.id);
      if (this.sourceFor(layer.clip)?.missing) continue;
      // A file that cannot play would hold the clock forever; it shows as a marked box instead.
      if (this.failureFor(layer.clip)) continue;
      if (!element || element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return false;
    }
    return true;
  }

  private failureFor(clip: Clip): MediaProblemKind | undefined {
    const url = this.urlFor(clip);
    return url ? this.failures.get(url) : undefined;
  }

  /** Records the first problem a URL shows; later ones from the same file add nothing. */
  private fail(
    pool: Map<string, HTMLMediaElement>,
    id: string,
    element: HTMLMediaElement,
    kind: MediaProblemKind,
  ): void {
    const url = element.dataset.url;
    // A released element reports its own teardown; only one still in use speaks for its file.
    if (!url || pool.get(id) !== element || this.failures.has(url)) return;
    this.failures.set(url, kind);
    this.updateProblems();
    if (!this.playing) this.render();
  }

  private updateProblems(): void {
    const next: MediaProblem[] = [];
    for (const [sourceId, location] of this.sources) {
      if (location.missing) continue;
      const kind = this.failures.get(mediaUrl(location.path, location.version));
      if (kind) next.push({ sourceId, kind });
    }
    const same =
      next.length === this.problems.length &&
      next.every((item, index) => {
        const before = this.problems[index];
        return before.sourceId === item.sourceId && before.kind === item.kind;
      });
    if (same) return;
    this.problems = next;
    this.emitState();
  }

  private watchForFailure(
    pool: Map<string, HTMLMediaElement>,
    id: string,
    element: HTMLMediaElement,
  ): void {
    element.addEventListener("error", () =>
      this.fail(pool, id, element, problemFromError(element.error)),
    );
    if (!(element instanceof HTMLVideoElement)) return;
    // A file whose only picture stream the browser cannot decode may still load its sound.
    element.addEventListener("loadedmetadata", () => {
      if (element.videoWidth === 0) this.fail(pool, id, element, "no-picture");
    });
    // A background tab may defer loading media, so the wait only counts while it is shown.
    const check = () => {
      if (pool.get(id) !== element) return;
      if (document.visibilityState === "hidden") window.setTimeout(check, MEDIA_STALL_MS);
      else if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !element.error)
        this.fail(pool, id, element, "stalled");
    };
    window.setTimeout(check, MEDIA_STALL_MS);
  }

  private sourceFor(clip: Clip): SourceLocation | undefined {
    return clip.source_id ? this.sources.get(clip.source_id) : undefined;
  }

  private urlFor(clip: Clip): string | null {
    const location = this.sourceFor(clip);
    if (!location || location.missing) return null;
    return mediaUrl(location.path, location.version);
  }

  private release<T extends HTMLMediaElement>(pool: Map<string, T>, id: string, element: T): void {
    element.pause();
    element.removeAttribute("src");
    element.load();
    pool.delete(id);
    this.gains.get(id)?.disconnect();
    this.gains.delete(id);
  }

  private videoFor(clip: Clip): HTMLVideoElement | null {
    const url = this.urlFor(clip);
    if (!url) return null;
    let element = this.videos.get(clip.id);
    if (element && element.dataset.url !== url) {
      this.release(this.videos, clip.id, element);
      element = undefined;
    }
    if (!element) {
      element = document.createElement("video");
      element.muted = true;
      element.playsInline = true;
      element.preload = "auto";
      element.dataset.url = url;
      element.src = url;
      const redraw = () => {
        if (!this.playing) this.render();
      };
      element.addEventListener("loadeddata", redraw);
      element.addEventListener("seeked", redraw);
      this.videos.set(clip.id, element);
      this.watchForFailure(this.videos, clip.id, element);
    }
    return element;
  }

  private audioFor(clip: Clip): HTMLAudioElement | null {
    const url = this.urlFor(clip);
    if (!url) return null;
    let element = this.audios.get(clip.id);
    if (element && element.dataset.url !== url) {
      this.release(this.audios, clip.id, element);
      element = undefined;
    }
    if (!element) {
      element = new Audio();
      element.preload = "auto";
      element.dataset.url = url;
      element.src = url;
      element.preservesPitch = true;
      this.audios.set(clip.id, element);
      this.watchForFailure(this.audios, clip.id, element);
      this.connectGain(clip.id, element);
    }
    return element;
  }

  private ensureAudioContext(): void {
    if (this.audioContext || typeof AudioContext === "undefined") return;
    try {
      const context = new AudioContext();
      // Every clip's gain feeds one master, which the meters read; mono sources count twice.
      const master = context.createGain();
      master.channelCount = 2;
      master.channelCountMode = "explicit";
      master.channelInterpretation = "speakers";
      master.connect(context.destination);
      const splitter = context.createChannelSplitter(2);
      master.connect(splitter);
      const meters = [0, 1].map((channel) => {
        const meter = context.createAnalyser();
        meter.fftSize = METER_WINDOW;
        splitter.connect(meter, channel);
        return meter;
      });
      this.audioContext = context;
      this.master = master;
      this.meters = [meters[0], meters[1]];
      for (const [id, element] of this.audios) this.connectGain(id, element);
    } catch {
      this.audioContext = null;
      this.master = null;
      this.meters = null;
    }
  }

  /** Gain above 1 needs Web Audio; without it the element's volume caps at 1. */
  private connectGain(id: string, element: HTMLAudioElement): void {
    if (!this.audioContext || !this.master || this.gains.has(id)) return;
    try {
      const source = this.audioContext.createMediaElementSource(element);
      const gain = this.audioContext.createGain();
      source.connect(gain).connect(this.master);
      this.gains.set(id, gain);
    } catch {
      // Already routed, or the browser refused; the element's own volume still works.
    }
  }

  /** Puts every element where the clock says it should be, and starts or stops it. */
  private sync(): void {
    const project = this.project;
    if (!project) return;
    const time = pictureTime(project, this.time);
    const fades = transitionFades(project);
    const visible = new Set(layersAt(project, time, fades).map((layer) => layer.clip.id));

    for (const clip of project.clips) {
      if (clip.kind !== "video") continue;
      const near =
        clip.start - KEEP_AROUND_SECONDS < time && time < clipEnd(clip) + KEEP_AROUND_SECONDS;
      const existing = this.videos.get(clip.id);
      if (!near) {
        if (existing) this.release(this.videos, clip.id, existing);
        continue;
      }
      const active = visible.has(clip.id);
      const upcoming = !active && clip.start > time && clip.start - time < CUE_AHEAD_SECONDS;
      if (!active && !upcoming) {
        existing?.pause();
        continue;
      }
      const element = this.videoFor(clip);
      if (!element) continue;
      const target = active ? sourceTimeAt(clip, time) : clip.source_in;
      this.place(element, clip, target, active && this.playing);
    }

    const voices = new Map(voicesAt(project, time, fades).map((voice) => [voice.clip.id, voice]));
    for (const clip of project.clips) {
      if (clip.kind !== "audio") continue;
      const voice = voices.get(clip.id);
      const upcoming = clip.start > time && clip.start - time < CUE_AHEAD_SECONDS;
      const existing = this.audios.get(clip.id);
      if (!voice && !upcoming) {
        existing?.pause();
        continue;
      }
      const element = this.audioFor(clip);
      if (!element) continue;
      const level = voice?.gain ?? 0;
      const gain = this.gains.get(clip.id);
      if (gain) {
        gain.gain.value = level;
        element.volume = 1;
      } else {
        element.volume = Math.min(1, level);
      }
      const target = voice ? sourceTimeAt(clip, time) : clip.source_in;
      this.place(element, clip, target, Boolean(voice) && this.playing && !this.waiting);
    }
  }

  private place(element: HTMLMediaElement, clip: Clip, target: number, run: boolean): void {
    if (element.readyState === HTMLMediaElement.HAVE_NOTHING) {
      // Called every frame while loading: one listener carries the latest target.
      element.dataset.pending = String(target);
      if (element.dataset.cueing) return;
      element.dataset.cueing = "1";
      element.addEventListener(
        "loadedmetadata",
        () => {
          delete element.dataset.cueing;
          const pending = Number(element.dataset.pending);
          if (Number.isFinite(pending)) element.currentTime = pending;
        },
        { once: true },
      );
      return;
    }
    element.playbackRate = clip.speed;
    const frame = 1 / (sourceById(this.project as Project, clip.source_id)?.frame_rate ?? 30);
    const drift = Math.abs(element.currentTime - target);
    if (run) {
      if (element.paused) {
        element.currentTime = target;
        void element.play().catch(() => undefined);
      } else if (drift > PLAYING_DRIFT_SECONDS) {
        element.currentTime = target;
      }
    } else {
      if (!element.paused) element.pause();
      if (drift > frame / 2 && !element.seeking) element.currentTime = target;
    }
  }

  /** Draws the frame at the current time. Missing media is drawn as a marked box, never left out. */
  render(): void {
    const canvas = this.canvas;
    const project = this.project;
    if (!canvas || !project) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const layers = layersAt(project, pictureTime(project, this.time));
    // A seek takes a shown video's frame away for a moment; drawing then would flash the
    // placeholder, so the last picture stays up until `seeked` draws the new one.
    if (layers.some((layer) => this.isBetweenFrames(layer.clip))) return;
    const scale = canvas.width / project.width;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.fillStyle = project.background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const fidelity = { adjustUnavailable: false, adjustReduced: false };
    for (const layer of layers) {
      if (layer.alpha <= 0) continue;
      this.drawLayer(context, project, layer, scale, fidelity);
    }
    if (
      fidelity.adjustUnavailable !== this.fidelity.adjustUnavailable ||
      fidelity.adjustReduced !== this.fidelity.adjustReduced
    ) {
      this.fidelity = fidelity;
      this.emitState();
    }
  }

  private drawLayer(
    context: CanvasRenderingContext2D,
    project: Project,
    layer: Layer,
    scale: number,
    fidelity: PreviewFidelity,
  ): void {
    const { clip } = layer;
    const place = placement(project, clip, pictureTime(project, this.time));
    const width = place.width * scale;
    const height = place.height * scale;
    context.save();
    context.globalAlpha = layer.alpha;
    context.translate(place.centerX * scale, place.centerY * scale);
    context.rotate((place.rotation * Math.PI) / 180);

    const failure = clip.kind === "title" ? undefined : this.failureFor(clip);
    const picture = failure ? null : this.pictureFor(clip);
    if (!picture) {
      this.drawPlaceholder(
        context,
        width,
        height,
        this.sourceFor(clip)?.missing
          ? "Missing media"
          : failure
            ? MEDIA_PROBLEM_LABELS[failure]
            : "Loading...",
      );
      context.restore();
      return;
    }
    const { source, sourceWidth, sourceHeight } = picture;
    const crop = clip.kind === "title" ? null : clip.crop;
    const adjusted = clip.kind !== "title" && !isAdjustIdentity(clip.adjust);
    const sx = crop ? crop.x * sourceWidth : 0;
    const sy = crop ? crop.y * sourceHeight : 0;
    const sw = crop ? crop.width * sourceWidth : sourceWidth;
    const sh = crop ? crop.height * sourceHeight : sourceHeight;
    const drawn = adjusted ? this.adjusted(clip, source, sx, sy, sw, sh) : null;
    if (adjusted && !drawn) fidelity.adjustUnavailable = true;
    if (drawn && sw > MAX_ADJUST_WIDTH) fidelity.adjustReduced = true;
    if (drawn) context.drawImage(drawn, -width / 2, -height / 2, width, height);
    else context.drawImage(source, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    context.restore();
  }

  /** A video that has shown a frame but has none to give right now, as while it seeks. */
  private isBetweenFrames(clip: Clip): boolean {
    if (clip.kind !== "video") return false;
    const element = this.videos.get(clip.id);
    return (
      element?.dataset.shown === "1" && element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    );
  }

  private pictureFor(clip: Clip): {
    source: CanvasImageSource;
    sourceWidth: number;
    sourceHeight: number;
  } | null {
    if (clip.kind === "video") {
      const element = this.videos.get(clip.id) ?? this.videoFor(clip);
      if (!element || element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
      element.dataset.shown = "1";
      return {
        source: element,
        sourceWidth: element.videoWidth,
        sourceHeight: element.videoHeight,
      };
    }
    const url =
      clip.kind === "title" && clip.title && this.project
        ? titleImageUrl(clip.title, this.project.width, this.project.height)
        : this.urlFor(clip);
    if (!url) return null;
    let image = this.images.get(url);
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => {
        if (!this.playing) this.render();
      });
      image.src = url;
      this.images.set(url, image);
    }
    if (!image.complete || image.naturalWidth === 0) return null;
    return { source: image, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
  }

  /** The clip's crop run through the same LUT and detail passes as the quick editor's preview. */
  private adjusted(
    clip: Clip,
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): HTMLCanvasElement | null {
    let slot = this.adjusters.get(clip.id);
    if (!slot) {
      const canvas = document.createElement("canvas");
      slot = {
        canvas,
        staging: document.createElement("canvas"),
        renderer: AdjustRenderer.create(canvas),
        key: "",
      };
      this.adjusters.set(clip.id, slot);
    }
    const renderer = slot.renderer;
    if (!renderer) return null;
    const ratio = Math.min(1, MAX_ADJUST_WIDTH / Math.max(1, sw));
    const width = Math.max(2, Math.round(sw * ratio));
    const height = Math.max(2, Math.round(sh * ratio));
    for (const target of [slot.canvas, slot.staging]) {
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
    }
    const staging = slot.staging.getContext("2d");
    if (!staging) return null;
    staging.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    const key = JSON.stringify(clip.adjust);
    if (slot.key !== key) {
      renderer.setLut(
        isGlobalIdentity(clip.adjust) ? null : buildAdjustLut(clip.adjust, ADJUST_PREVIEW_LUT_SIZE),
        ADJUST_PREVIEW_LUT_SIZE,
      );
      slot.key = key;
    }
    renderer.setSource(slot.staging, width, height, false);
    const whole = { x: 0, y: 0, width: 1, height: 1 };
    renderer.render({
      view: whole,
      crop: whole,
      outputScale: 1,
      outputSize: { width, height },
      detail: { noiseReduction: clip.adjust.noise_reduction, definition: clip.adjust.definition },
      original: false,
    });
    return slot.canvas;
  }

  private drawPlaceholder(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    label: string,
  ): void {
    const canvas = context.canvas;
    context.fillStyle = canvasColor(canvas, "--media-scrim");
    context.fillRect(-width / 2, -height / 2, width, height);
    context.strokeStyle = canvasColor(canvas, "--media-warning");
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.strokeRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2);
    context.setLineDash([]);
    context.fillStyle = canvasColor(canvas, "--media-warning");
    context.font = `${Math.max(10, Math.round(Math.min(width, height) / 10))}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 0, 0);
  }
}

/** Theme tokens resolved at draw time, so the canvas follows the same colours as the page. */
function canvasColor(canvas: HTMLCanvasElement, token: string): string {
  return getComputedStyle(canvas).getPropertyValue(token).trim() || "gray";
}
