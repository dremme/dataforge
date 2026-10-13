import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { WORKSPACE, openWorkspace } from "./workspace";

const drafts = () =>
  fs.readdirSync(WORKSPACE).filter((name) => name.endsWith(".video-project.json"));

test("edits a video into a saved project, reopens it from the gallery and deletes it", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  await page.getByRole("button", { name: "Open clip.mp4 in the video editor" }).click();

  // The editor opens on the video at 00:00; the fixture clip has no sound.
  const name = page.getByRole("textbox", { name: "Project name" });
  await expect(name).toBeVisible();
  await expect(page.getByRole("button", { name: /^clip\.mp4, 00:00 to 00:02/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Add title" }).click();
  await expect(page.getByRole("button", { name: /^Title, 00:00 to / })).toBeVisible();
  await name.fill("E2E cut");
  await name.press("Enter");

  // Autosave writes a draft beside the video.
  await expect(page.locator(".video-editor__save")).toHaveText("Saved");
  expect(drafts()).toHaveLength(1);
  const saved = JSON.parse(fs.readFileSync(path.join(WORKSPACE, drafts()[0]), "utf8")) as {
    name: string;
    clips: { kind: string }[];
  };
  expect(saved.name).toBe("E2E cut");
  expect(saved.clips.map((clip) => clip.kind).sort()).toEqual(["title", "video"]);

  await page.getByRole("button", { name: "Back to gallery" }).click();
  await expect(name).toBeHidden();
  await page
    .getByRole("region", { name: "Video projects" })
    .getByRole("button", { name: "Open the video project E2E cut in the video editor" })
    .click();
  await expect(name).toHaveValue("E2E cut");
  await expect(page.getByRole("button", { name: /^Title, 00:00 to / })).toBeVisible();

  // Deleting leaves the workspace as the other specs expect it.
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: /^Delete project/ }).click();
  await page.getByRole("button", { name: "Delete project", exact: true }).click();
  // The confirmation hides the editor from the accessibility tree, so wait for the editor itself.
  await expect(page.locator(".video-editor")).toHaveCount(0);
  await expect.poll(drafts).toHaveLength(0);
});
