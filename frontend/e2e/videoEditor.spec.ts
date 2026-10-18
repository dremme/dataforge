import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { WORKSPACE, openWorkspace } from "./workspace";

const drafts = () =>
  fs.readdirSync(WORKSPACE).filter((name) => name.endsWith(".video-project.json"));

/**
 * Ctrl plus a letter as a German QWERTZ keyboard reports it: Z and Y trade places, so the key
 * labelled Z has the physical code of QWERTY's Y. Playwright's own presses are always QWERTY.
 */
async function pressQwertz(page: Page, letter: "z" | "y") {
  const session = await page.context().newCDPSession(page);
  const key = {
    key: letter,
    code: letter === "z" ? "KeyY" : "KeyZ",
    windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0),
    modifiers: 2, // Ctrl
  };
  await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await session.detach();
}

test("edits a video into a saved project, reopens it from the gallery and deletes it", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "View clip.mp4", exact: true }).click();
  await page.getByRole("button", { name: "Open clip.mp4 in the video editor" }).click();

  // The editor opens on the video at 00:00; the fixture clip has no sound.
  const name = page.getByRole("textbox", { name: "Project name" });
  await expect(name).toBeVisible();
  await expect(page.getByRole("button", { name: /^clip\.mp4, 00:00 to 00:02/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Add title" }).click();
  const title = page.getByRole("button", { name: /^Title, 00:00 to / });
  await expect(title).toBeVisible();

  // Undo and redo from the keyboard, on QWERTY and on a layout that swaps Z and Y.
  await page.keyboard.press("Control+z");
  await expect(title).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(title).toBeVisible();
  await pressQwertz(page, "z");
  await expect(title).toHaveCount(0);
  await pressQwertz(page, "y");
  await expect(title).toBeVisible();
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

  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("menuitem", { name: /^Versions/ }).click();
  const versions = page.getByRole("dialog", { name: "Project versions" });
  await expect(versions).toBeVisible();
  await expect(versions.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("versions-modal.png"),
    animations: "disabled",
  });
  await versions.getByRole("button", { name: "Close", exact: true }).click();

  // The editor is a route: its address names the saved draft, so a reload reopens it, Back
  // returns to the gallery and Forward comes back.
  const draftAddress = new RegExp(`/editor/project\\?path=.+${drafts()[0].replace(/\./g, "\\.")}$`);
  await expect(page).toHaveURL(draftAddress);
  await page.reload();
  await expect(name).toHaveValue("E2E cut");
  await page.goBack();
  await expect(name).toBeHidden();
  await expect(page).toHaveURL(/\/\?path=/);
  await expect(page.getByRole("region", { name: "Video projects" })).toBeVisible();
  await page.goForward();
  await expect(name).toHaveValue("E2E cut");

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

test("leaves an untouched empty project with Back and with its own button", async ({ page }) => {
  await openWorkspace(page);
  const name = page.getByRole("textbox", { name: "Project name" });

  await page.getByRole("button", { name: "Open video editor" }).click();
  await expect(name).toHaveValue("Untitled project");
  await expect(page).toHaveURL(/\/editor\/new\?path=/);
  await page.goBack();
  await expect(page.locator(".video-editor")).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?path=/);

  await page.getByRole("button", { name: "Open video editor" }).click();
  await expect(name).toHaveValue("Untitled project");
  await page.getByRole("button", { name: "Back to gallery" }).click();
  await expect(page.locator(".video-editor")).toHaveCount(0);
  expect(drafts()).toHaveLength(0);
});
