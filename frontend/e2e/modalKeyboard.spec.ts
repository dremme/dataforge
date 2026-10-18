import { expect, test } from "@playwright/test";
import { openWorkspace } from "./workspace";

for (const name of ["Cancel", "Close"]) {
  test(`Enter activates the focused ${name} without starting a job`, async ({ page }) => {
    let starts = 0;
    await page.route("**/api/automation/auto-caption?**", (route) => {
      starts += 1;
      return route.fulfill({ status: 503, json: { detail: "No job should start." } });
    });
    await openWorkspace(page);
    await page.getByRole("button", { name: "Auto-caption", exact: true }).click();
    const modal = page.getByRole("alertdialog", { name: "Start auto-caption?" });
    const dismiss = modal.getByRole("button", { name, exact: true });
    await dismiss.focus();
    // Exercise the shortcut after the opening key guard has expired.
    await page.waitForTimeout(150);
    await dismiss.press("Enter");

    await expect(modal).toHaveCount(0);
    expect(starts).toBe(0);
  });
}

test("Escape dismisses the discard confirmation and retains the instruction draft", async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "Edit instructions", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Folder instructions" });
  const prompt = editor.getByRole("textbox", { name: "System prompt" });
  const draft = "Describe the scene using the edited instructions.";
  await prompt.fill(draft);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(confirmation).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(prompt).toHaveText(draft);
});

test("keyboard shortcuts has one close control and dismisses through its backdrop", async ({
  page,
}, testInfo) => {
  await openWorkspace(page);
  await expect(page.getByRole("button", { name: "View photo.png", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  const modal = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "Close", exact: true })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(modal).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("shortcuts-modal.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close modal", exact: true }).click({
    position: { x: 8, y: 8 },
  });
  await expect(modal).toHaveCount(0);
});
