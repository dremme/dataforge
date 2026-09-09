import { expect, test } from "@playwright/test";
import { WORKSPACE, imageParts, readModelRequests, readSidecar, systemText } from "./workspace";

// Answered by the stand-in model in scripts/e2e_backend.py.
const CAPTION =
  "A red hatchback is parked on a gravel driveway beside a low stone wall, with a row of " +
  "birch trees standing behind it and a wooden gate left open at the far end. Late " +
  "afternoon light rakes across the gravel and throws long shadows toward the camera, and " +
  "a bicycle leans against the wall on the left.";

const SYSPROMPT = "Describe the scene plainly, in one paragraph.";

test("auto-captions a still and a clip, and shows both captions back", async ({ page }) => {
  // The folder rides the URL, so the run opens on the fixture with no browsing to drive.
  await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);

  await expect(page.getByText("photo.png")).toBeVisible();
  await expect(page.getByText("clip.mp4")).toBeVisible();

  await page.locator("button.automation__start").click();
  const dialog = page.getByRole("alertdialog", { name: "Start auto-caption?" });
  await dialog.getByRole("button", { name: "Start auto-caption" }).click();

  // Two real decodes and two model round trips; the poll that reports it is on its own clock.
  const status = page.locator(".automation__status-label");
  await expect(status).toHaveText("Completed", { timeout: 90_000 });
  await expect(page.locator(".automation__counts")).toContainText("2/2");

  // Read back through the listing: proves the sidecar landed and the caption memo let go of it.
  await expect(page.locator(".card__description")).toHaveCount(2);
  for (const description of await page.locator(".card__description").allTextContents()) {
    expect(description).toBe(CAPTION);
  }

  // No trailing newline: auto-caption saves with trailing_newline=False.
  expect(readSidecar("photo.txt")).toBe(CAPTION);
  expect(readSidecar("clip.txt")).toBe(CAPTION);

  const requests = readModelRequests();
  expect(requests).toHaveLength(2);

  for (const request of requests) {
    expect(systemText(request)).toContain(SYSPROMPT);
    for (const part of imageParts(request)) {
      expect(part.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);
    }
  }

  // The clip is sampled across its length; a still is sent as the one frame it has.
  const frameCounts = requests.map((request) => imageParts(request).length).sort();
  expect(frameCounts[0]).toBe(1);
  expect(frameCounts[1]).toBeGreaterThan(1);
});
