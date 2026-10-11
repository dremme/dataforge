import { expect, test } from "@playwright/test";
import { openWorkspace } from "./workspace";

for (const [model, title, architecture] of [
  ["krea2_raw", "Krea 2 Raw", "krea2"],
  ["qwen_image_2_turbo", "Qwen Image 2.1 Turbo (w/ Training Adapter)", "qwen_image_2:turbo"],
]) {
  test(`${title}: loads its template and submits the selected model`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await page.route("**/api/external/ostris/jobs", (route) =>
      route.fulfill({ json: { jobs: [], active_count: 0, available: true, revision: 1 } }),
    );
    await page.route("**/api/automation/train-lora?**", (route) =>
      route.fulfill({
        status: 503,
        json: { detail: "Training service unavailable in this test." },
      }),
    );
    await openWorkspace(page);
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Quick LoRA training/ }).click();
    const dialog = page.getByRole("alertdialog", { name: "Start LoRA training?" });
    await dialog.getByRole("combobox", { name: "Model" }).selectOption(model);
    await expect(dialog).toContainText(`Trains a ${title} LoRA`);
    await dialog.getByLabel("LoRA name", { exact: true }).fill("sample_train_v1");
    await page.screenshot({
      path: testInfo.outputPath("training-dialog.png"),
      animations: "disabled",
    });

    await dialog.getByRole("button", { name: "Edit template" }).click();
    const editor = page.getByRole("dialog", { name: `Edit the ${title} training template` });
    await editor.locator(".cm-scroller").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(editor.locator(".cm-content")).toContainText(`arch: "${architecture}"`);
    if (model === "qwen_image_2_turbo") {
      await expect(editor.locator(".cm-content")).toContainText("assistant_lora_path:");
      await expect(editor.locator(".cm-content")).toContainText("turbo: true");
    }
    await page.screenshot({
      path: testInfo.outputPath("training-template.png"),
      animations: "disabled",
    });
    await editor.getByRole("button", { name: "Close", exact: true }).click();

    const submitted = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/api/automation/train-lora?"),
    );
    await dialog.getByRole("button", { name: "Start training", exact: true }).click();
    expect((await submitted).postDataJSON()).toMatchObject({
      model,
      lora_name: "sample_train_v1",
      template: null,
    });
  });
}
