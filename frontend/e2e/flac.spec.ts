import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace";

test("FLAC files show a waveform and play in the gallery", async ({ page }, testInfo) => {
  const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
  const python = path.join(
    backend,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const folder = fs.mkdtempSync(path.join(WORKSPACE, "flac-playback-"));
  execFileSync(
    python,
    [
      "-c",
      "import sys; from pathlib import Path; from testing_fixtures import write_flac; write_flac(Path(sys.argv[1]))",
      folder,
    ],
    { cwd: backend },
  );

  await page.goto(`/?path=${encodeURIComponent(folder)}`);
  const card = page.getByRole("button", { name: "View tone.flac", exact: true });
  await expect(card.locator(".card__waveform")).toBeVisible();
  await card.click();
  const inspector = page.getByRole("complementary", { name: "Viewing tone.flac" });
  const audio = inspector.locator("audio");
  await expect(audio).toHaveJSProperty("duration", 2);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await page.screenshot({ path: testInfo.outputPath("flac-player.png"), animations: "disabled" });
});
