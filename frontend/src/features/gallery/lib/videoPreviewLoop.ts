const SEEK_TIMEOUT_MS = 2500;
const PRESENT_TIMEOUT_MS = 150;
// Consecutive failed preparations or handoffs before laps stop re-arming the standby.
const MAX_FAILURES = 3;

interface LoopOptions {
  videos: readonly HTMLVideoElement[];
  getRange: () => { start: number; end: number };
  getFrameDuration: () => number;
  onSwitch: (index: number) => void;
  onPlayError: () => void;
}

/** Prepares the next decoder while the visible decoder plays, without changing trim precision. */
export class VideoPreviewLoop {
  private index = 0;
  private prepared: { video: HTMLVideoElement; start: number; end: number } | null = null;
  private pending: { start: number; end: number } | null = null;
  private failures = 0;
  private cancelPending: (() => void) | null = null;
  private generation = 0;
  private disposed = false;
  handingOff = false;

  constructor(private readonly options: LoopOptions) {}

  get current(): HTMLVideoElement {
    return this.options.videos[this.index];
  }

  private get standby(): HTMLVideoElement | undefined {
    return this.options.videos[1 - this.index];
  }

  invalidate(): void {
    this.generation += 1;
    this.cancelPending?.();
    this.cancelPending = null;
    this.prepared = null;
    this.pending = null;
    this.handingOff = false;
    const standby = this.standby;
    if (standby) {
      standby.pause();
      standby.muted = true;
    }
  }

  /** Readies the standby at the in point; a no-op while it is ready or readying for this range. */
  prepare(): void {
    const { start, end } = this.options.getRange();
    const target = this.prepared ?? this.pending;
    if (!this.handingOff && target && target.start === start && target.end === end) return;
    this.invalidate();
    const video = this.standby;
    if (!video || this.disposed || !Number.isFinite(end) || end <= start) return;
    const generation = this.generation;
    let frame = 0;
    let timer = 0;
    let presentationTimer = 0;
    let settled = false;
    let presented = false;
    let started = false;
    const valid = () => !this.disposed && generation === this.generation;
    const cleanup = () => {
      window.clearTimeout(timer);
      window.clearTimeout(presentationTimer);
      if (frame) video.cancelVideoFrameCallback(frame);
      video.removeEventListener("loadedmetadata", seek);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("error", fail);
    };
    const fail = () => {
      cleanup();
      if (valid()) {
        this.generation += 1;
        this.cancelPending = null;
        this.pending = null;
        this.failures += 1;
      }
    };
    const ready = () => {
      if (!valid() || !settled || video.seeking || video.readyState < video.HAVE_FUTURE_DATA)
        return;
      if (!presented) return;
      cleanup();
      this.cancelPending = null;
      this.pending = null;
      this.prepared = { video, start, end };
    };
    const seeked = () => {
      settled = !video.seeking && Math.abs(video.currentTime - start) < 0.001;
      ready();
      // Some browsers do not present paused, transparent media through a frame callback.
      if (settled && !presented && !presentationTimer) {
        presentationTimer = window.setTimeout(() => {
          presented = video.readyState >= video.HAVE_CURRENT_DATA;
          ready();
        }, PRESENT_TIMEOUT_MS);
      }
    };
    const seek = () => {
      if (started || !valid() || video.readyState < video.HAVE_METADATA) return;
      started = true;
      // Timed from the seek, so a slow first load of the file does not count against it.
      timer = window.setTimeout(fail, SEEK_TIMEOUT_MS);
      if (typeof video.requestVideoFrameCallback === "function") {
        frame = video.requestVideoFrameCallback((_now, metadata) => {
          frame = 0;
          presented = Math.abs(metadata.mediaTime - start) <= this.options.getFrameDuration();
          ready();
        });
      } else {
        presented = true;
      }
      if (!video.seeking && Math.abs(video.currentTime - start) < 0.001) {
        seeked();
      } else {
        video.currentTime = start;
      }
    };
    this.cancelPending = cleanup;
    this.pending = { start, end };
    video.addEventListener("loadedmetadata", seek);
    video.addEventListener("loadeddata", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("seeked", seeked);
    video.addEventListener("error", fail);
    seek();
  }

  play(video = this.current): void {
    const generation = this.generation;
    void video.play().catch(() => {
      if (!this.disposed && generation === this.generation && video === this.current) {
        video.pause();
        this.options.onPlayError();
      }
    });
  }

  lap(): void {
    const outgoing = this.current;
    if (this.disposed || outgoing.seeking || this.handingOff) return;
    const prepared = this.prepared;
    const range = this.options.getRange();
    const incoming =
      prepared && prepared.start === range.start && prepared.end === range.end
        ? prepared.video
        : null;
    if (
      !incoming ||
      incoming.seeking ||
      incoming.readyState < incoming.HAVE_FUTURE_DATA ||
      incoming.error
    ) {
      this.prepared = null;
      outgoing.currentTime = range.start;
      if (outgoing.paused) this.play(outgoing);
      if (this.failures < MAX_FAILURES) this.prepare();
      return;
    }

    this.prepared = null;
    this.handingOff = true;
    const generation = this.generation;
    let frame = 0;
    let animation = 0;
    let timer = 0;
    const valid = () => {
      const currentRange = this.options.getRange();
      return (
        !this.disposed &&
        generation === this.generation &&
        currentRange.start === range.start &&
        currentRange.end === range.end
      );
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      if (frame) incoming.cancelVideoFrameCallback(frame);
      if (animation) cancelAnimationFrame(animation);
      incoming.removeEventListener("playing", playing);
    };
    const fail = () => {
      if (!valid()) return;
      this.failures += 1;
      this.invalidate();
      outgoing.currentTime = this.options.getRange().start;
      this.play(outgoing);
    };
    const switchPlayer = () => {
      if (!valid()) return;
      cleanup();
      this.cancelPending = null;
      this.index = 1 - this.index;
      const muted = outgoing.muted;
      outgoing.muted = true;
      outgoing.pause();
      // Switch as soon as the frame is ready, without waiting for React's next commit.
      outgoing.style.opacity = "0";
      incoming.style.opacity = "1";
      incoming.muted = muted;
      this.handingOff = false;
      this.failures = 0;
      this.options.onSwitch(this.index);
      this.prepare();
    };
    const playing = () => {
      animation = requestAnimationFrame(switchPlayer);
    };
    this.cancelPending = cleanup;
    incoming.playbackRate = outgoing.playbackRate;
    incoming.volume = outgoing.volume;
    incoming.muted = true;
    outgoing.pause();
    if (typeof incoming.requestVideoFrameCallback === "function") {
      frame = incoming.requestVideoFrameCallback(() => {
        frame = 0;
        switchPlayer();
      });
    } else {
      incoming.addEventListener("playing", playing, { once: true });
    }
    timer = window.setTimeout(fail, SEEK_TIMEOUT_MS);
    void incoming
      .play()
      .then(() => {
        // The prepared first frame can already be composited when play resolves, before rVFC.
        if (valid() && incoming.readyState >= incoming.HAVE_FUTURE_DATA && !incoming.seeking) {
          switchPlayer();
        }
      })
      .catch(fail);
  }

  /** Abandons a pending handoff and readies the standby again; reports whether one was pending. */
  cancelHandoff(): boolean {
    if (!this.handingOff) return false;
    this.invalidate();
    this.prepare();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
    for (const video of this.options.videos) video.pause();
  }
}
