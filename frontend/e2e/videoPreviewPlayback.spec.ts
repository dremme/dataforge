import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const python = path.join(
  projectRoot,
  "backend",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
// High enough that a stalled lap shows as several dropped frames, not a fraction of one.
const RATE = 60;
// Seconds from the keyframe to the in point: enough decoding that a seek stalls the old loop.
const IN_POINT = 4;

interface Picture {
  now: number;
  time: number;
  slot: number;
}

for (const overlays of [false, true]) {
  test(`trimmed preview hands off decoded frames${overlays ? " with Adjust and Blur" : ""}`, async ({
    page,
  }, testInfo) => {
    const ffmpeg = execFileSync(
      python,
      ["-c", "from ffmpeg_bin import ffmpeg_path; print(ffmpeg_path() or '')"],
      { cwd: path.join(projectRoot, "backend"), encoding: "utf8" },
    ).trim();
    test.setTimeout(60_000);
    const name = overlays ? "loop-overlays.mp4" : "loop-preview.mp4";
    // One keyframe per five seconds and a heavy 1080p stream, so a seek to the in point decodes
    // about 240 frames: the single-player seek loop measured ~450 ms there, the handoff 17 ms.
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1920x1080:rate=${RATE}`,
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-b:v",
      "40M",
      "-g",
      String(RATE * 5),
      "-keyint_min",
      String(RATE * 5),
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-an",
      path.join(WORKSPACE, name),
    ]);

    // Records what the Adjust and Blur canvases draw, since they cover the video elements.
    await page.addInitScript(() => {
      const drawn: Record<"adjust" | "blur", { now: number; time: number; slot: number }[]> = {
        adjust: [],
        blur: [],
      };
      // Blur cuts from the Adjust canvas while it is live; credit that to the visible player.
      const record = (canvas: keyof typeof drawn, source: unknown) => {
        const videos = Array.from(
          document.querySelectorAll<HTMLVideoElement>(".gallery-item-modal__video"),
        );
        const video =
          source instanceof HTMLVideoElement
            ? source
            : source instanceof HTMLCanvasElement
              ? videos.find((candidate) => getComputedStyle(candidate).opacity !== "0")
              : undefined;
        if (!video) return;
        const slot = videos.indexOf(video);
        drawn[canvas].push({ now: performance.now(), time: video.currentTime, slot });
      };
      const texImage2D = WebGL2RenderingContext.prototype.texImage2D;
      WebGL2RenderingContext.prototype.texImage2D = function (
        this: WebGL2RenderingContext,
        ...args: unknown[]
      ) {
        record("adjust", args.at(-1));
        return (texImage2D as (...values: unknown[]) => void).apply(this, args);
      } as typeof texImage2D;
      const drawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ) {
        record("blur", args[0]);
        return (drawImage as (...values: unknown[]) => void).apply(this, args);
      } as typeof drawImage;
      Object.assign(window, { previewDrawn: drawn });
    });

    await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
    await page.getByRole("button", { name: `View ${name}` }).click();
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const pause = page.getByRole("button", { name: "Pause preview" });
    await expect(pause).toBeEnabled();
    await pause.click();
    const start = page.getByRole("slider", { name: "Trim start", exact: true });
    const end = page.getByRole("slider", { name: "Trim end", exact: true });
    await start.focus();
    await start.press("Home");
    for (let second = 0; second < IN_POINT; second += 1) await start.press("Shift+ArrowRight");
    await start.press("ArrowRight");
    await end.focus();
    await end.press("Home");
    await end.press("Shift+ArrowRight");
    await expect
      .poll(async () => Number(await start.getAttribute("aria-valuenow")))
      .toBeCloseTo(IN_POINT + 1 / RATE, 6);
    if (overlays) {
      await page.getByRole("button", { name: "Adjust", exact: true }).click();
      await page.getByRole("tab", { name: /^Exposure/ }).click();
      await page.getByRole("slider", { name: "Exposure", exact: true }).press("Shift+ArrowRight");
      await expect(page.locator("canvas.adjust-canvas")).toBeVisible();
      await page.getByRole("button", { name: "Blur", exact: true }).click();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByRole("group", { name: "Blur regions" })).toBeVisible();
    }
    await page.getByRole("button", { name: "Unmute preview" }).click();

    await page.evaluate(() => {
      const frames: { now: number; time: number; slot: number }[] = [];
      const seeks: { slot: number; visible: boolean; time: number; now: number }[] = [];
      const audio: number[] = [];
      const videos = Array.from(
        document.querySelectorAll<HTMLVideoElement>(".gallery-item-modal__video"),
      );
      const visible = (video: HTMLVideoElement) => {
        const style = getComputedStyle(video);
        return style.visibility !== "hidden" && style.opacity !== "0";
      };
      videos.forEach((video, slot) => {
        const frame: VideoFrameRequestCallback = (now, metadata) => {
          if (visible(video)) frames.push({ now, time: metadata.mediaTime, slot });
          audio.push(videos.filter((candidate) => !candidate.paused && !candidate.muted).length);
          video.requestVideoFrameCallback(frame);
        };
        video.requestVideoFrameCallback(frame);
        video.addEventListener("seeking", () =>
          seeks.push({
            slot,
            visible: visible(video),
            time: video.currentTime,
            now: performance.now(),
          }),
        );
      });
      const drawn = (window as unknown as { previewDrawn: Record<string, unknown[]> }).previewDrawn;
      for (const pictures of Object.values(drawn)) pictures.length = 0;
      Object.assign(window, { previewFrames: frames, previewSeeks: seeks, previewAudio: audio });
    });
    // Allow the paused standby to prepare before measuring repeated loops.
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Play preview" }).click();
    await page.waitForTimeout(6500);
    await page.getByRole("button", { name: "Pause preview" }).click();
    const metrics = await page.evaluate(() => {
      const state = window as unknown as {
        previewFrames: Picture[];
        previewDrawn: Record<"adjust" | "blur", Picture[]>;
        previewSeeks: { slot: number; visible: boolean; time: number; now: number }[];
        previewAudio: number[];
      };
      // A lap is where the picture changes decoder or jumps back to the in point.
      const lapGaps = (pictures: Picture[]) =>
        pictures.flatMap((picture, index) => {
          const previous = pictures[index - 1];
          return previous && (picture.slot !== previous.slot || picture.time < previous.time)
            ? [picture.now - previous.now]
            : [];
        });
      return {
        gaps: lapGaps(state.previewFrames),
        adjustGaps: lapGaps(state.previewDrawn.adjust),
        blurGaps: lapGaps(state.previewDrawn.blur),
        visibleSeeks: state.previewSeeks.filter((seek) => seek.visible).length,
        seeks: state.previewSeeks,
        maxAudible: Math.max(...state.previewAudio),
      };
    });
    await testInfo.attach("loop-metrics", {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
    const frameMs = 1000 / RATE;
    expect(metrics.gaps.length).toBeGreaterThanOrEqual(3);
    // Frame timestamps are rounded to display-clock ticks; allow one tick on top of two frames.
    expect(Math.max(...metrics.gaps)).toBeLessThanOrEqual(2 * frameMs + 1);
    expect(metrics.visibleSeeks).toBe(0);
    expect(metrics.maxAudible).toBe(1);
    // The canvases cover the video elements, so what they draw is what the user sees. They follow
    // the switch a frame late, after React's commit, and draw times are not display-clock ticks.
    if (overlays) {
      for (const gaps of [metrics.adjustGaps, metrics.blurGaps]) {
        expect(gaps.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(3 * frameMs);
      }
    }
  });
}
