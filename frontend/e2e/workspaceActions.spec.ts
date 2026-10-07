import path from "node:path";
import { expect, test } from "@playwright/test";
import type { FolderResponse, Job, JobFileResult, SystemSpecs } from "../src/shared/types";
import { WORKSPACE } from "./workspace";

const specs: SystemSpecs = {
  cpu_name: "Intel Core i7-12700K",
  cpu_cores: 16,
  cpu_load_percent: 38,
  memory_total_bytes: 32 * 1024 ** 3,
  memory_used_bytes: 8 * 1024 ** 3,
  gpu_name: "NVIDIA GeForce RTX 3080",
  gpu_available: true,
  gpu_load_percent: 81,
  gpu_memory_bytes: 10 * 1024 ** 3,
  gpu_memory_used_bytes: 4 * 1024 ** 3,
};

const landscape =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#53677f"/><circle cx="240" cy="45" r="22" fill="#e6c88e"/><path d="M0 160 95 40 210 170 260 85 320 150V200H0Z" fill="#293e48"/></svg>';

const scenarios = [
  "idle",
  "running",
  "completed",
  "failed",
  "cancelled",
  "training",
  "comfy",
] as const;

for (const width of [1024, 1440]) {
  for (const scenario of scenarios) {
    test(`${scenario} workspace actions and job activity at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const active = ["running", "training", "comfy"].includes(scenario);
      const status: Job["status"] = active
        ? "running"
        : scenario === "failed"
          ? "failed"
          : scenario === "cancelled"
            ? "cancelled"
            : "completed";
      const currentJob: Job | null =
        scenario === "idle"
          ? null
          : {
              id: "layout-job",
              folder: WORKSPACE,
              folder_name: "Sample folder",
              job_type:
                scenario === "training"
                  ? "train_lora"
                  : scenario === "comfy"
                    ? "comfy_process"
                    : "auto_caption",
              status,
              effective_status: status,
              warning: null,
              total: 48,
              processed: active ? 16 : scenario === "cancelled" ? 24 : 48,
              current_name: active ? "mountain-landscape.png" : null,
              stats: {
                success: 22,
                skipped: 1,
                write_error: 1,
                cancelled: scenario === "cancelled" ? 24 : 0,
              },
              error:
                scenario === "failed"
                  ? "Could not write the caption. Check folder permissions and retry."
                  : null,
              external_ref: scenario === "training" ? "sample_train_v1" : null,
              created_at: "2026-01-01T00:00:00.000Z",
              started_at: "2026-01-01T00:00:00.000Z",
              finished_at: active ? null : "2026-01-01T00:02:30.000Z",
              revision: 1,
            };
      const results: JobFileResult[] = Array.from({ length: 24 }, (_, index) => ({
        path: path.join(WORKSPACE, `landscape-${index}.png`),
        name: `landscape-${index}.png`,
        status: index === 0 ? "write_error" : index === 1 ? "skipped" : "success",
        message: index === 0 ? "Permission denied" : null,
      }));
      if (scenario === "cancelled") {
        results.push({
          path: path.join(WORKSPACE, "interrupted.png"),
          name: "interrupted.png",
          status: "cancelled",
        });
      }
      await page.route("**/api/folders/contents?**", async (route) => {
        const response = await route.fetch();
        const folder = (await response.json()) as FolderResponse;
        const original = folder.items.find((item) => item.media_type === "image")!;
        const items = Array.from({ length: 48 }, (_, index) => ({
          ...original,
          path: path.join(WORKSPACE, `landscape-${index}.png`),
          name: `landscape-${index}.png`,
          has_issue_file: index < 3,
          has_duplicate_file: index < 4,
          duplicate_group: index < 4 ? `group-${Math.floor(index / 2)}` : null,
          has_candidate: index < 4,
        }));
        await route.fulfill({
          json: { ...folder, items, item_count: items.length, subfolders: [], subfolder_count: 0 },
        });
      });
      await page.route("**/api/system/specs", (route) => route.fulfill({ json: specs }));
      await page.route("**/api/external/ostris/jobs", (route) =>
        route.fulfill({ json: { jobs: [], active_count: 0, available: true, revision: 1 } }),
      );
      await page.route("**/api/preferences/ui", (route) =>
        route.fulfill({
          json: { sort: "name", show_automation_specs: route.request().method() === "PUT" },
        }),
      );
      await page.route("**/api/jobs?**", (route) =>
        route.fulfill({
          json: {
            jobs: currentJob ? [currentJob] : [],
            active_count: active ? 1 : 0,
            total: currentJob ? 1 : 0,
            revision: 2,
          },
        }),
      );
      await page.route("**/api/jobs/folder-latest?**", (route) =>
        route.fulfill({ json: currentJob }),
      );
      await page.route("**/api/jobs/layout-job/results", (route) =>
        route.fulfill({ json: { job_id: "layout-job", results } }),
      );
      await page.route("**/api/thumbnail?**", (route) =>
        route.fulfill({ contentType: "image/svg+xml", body: landscape }),
      );
      await page.route("**/api/automation/comfy-process/logs", (route) =>
        route.fulfill({
          json: {
            available: true,
            lines: ["Loading workflow", "Sampling landscape: 16 / 48", "Decoding preview..."],
          },
        }),
      );
      await page.route("**/api/external/ostris/training/*/samples", (route) =>
        route.fulfill({
          json: {
            samples: Array.from({ length: 4 }, (_, index) => ({
              path: path.join(WORKSPACE, `sample-${index}.png`),
              name: `sample-${index}.png`,
              step: 200,
              prompt: "A mountain lake at sunrise",
            })),
          },
        }),
      );

      await page.goto(`/?path=${encodeURIComponent(WORKSPACE)}`);
      const controls = page.locator(".app-nav");
      await expect(controls).toBeVisible();
      const initialBox = (await controls.boundingBox())!;
      await expect(page.locator('.workspace-activity [role="progressbar"]')).toHaveCount(
        active ? 1 : 0,
      );
      await expect(page.getByRole("button", { name: "Cancel job" })).toHaveCount(active ? 1 : 0);
      await page.getByRole("button", { name: /^Review / }).click();
      const review = page.getByRole("menu", { name: "Review queues" });
      await expect(review).toBeVisible();
      await expect(review.locator(".workspace-review__item")).toHaveCount(3);
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath("review.png") });
      await page.keyboard.press("Escape");
      if (currentJob) {
        await page.getByRole("button", { name: "Job details", exact: true }).click();
        if (!active) {
          const toggle = page.getByRole("button", { name: /Per-file results/ });
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await toggle.click();
          await expect(page.locator(".job-file-results__row")).toHaveCount(results.length);
        }
        if (scenario === "comfy") {
          await page.getByRole("button", { name: "ComfyUI output", exact: true }).click();
          await expect(page.getByRole("region", { name: "ComfyUI output" })).toContainText(
            "Sampling landscape",
          );
        }
        if (scenario === "training") {
          await expect(page.getByRole("button", { name: /View training sample/ })).toHaveCount(4);
        }
        await page.screenshot({
          animations: "disabled",
          path: testInfo.outputPath("job-details.png"),
        });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Automation jobs" })).toHaveCount(0);
      }
      await page.getByRole("button", { name: "Toggle system specifications" }).click();
      await expect(page.getByRole("region", { name: "System specifications" })).toBeVisible();
      await page.screenshot({
        animations: "disabled",
        path: testInfo.outputPath("system-specs.png"),
      });
      // A running job replaces the start actions with Cancel.
      await expect(page.getByRole("button", { name: "Tools", exact: true })).toHaveCount(
        active ? 0 : 1,
      );
      if (!active) {
        await page.getByRole("button", { name: "Tools", exact: true }).click();
        const tools = page.getByRole("menu", { name: "Tools" });
        await expect(tools).toBeVisible();
        await expect(tools.getByRole("region", { name: "System specifications" })).toHaveCount(0);
        const box = (await tools.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.screenshot({ animations: "disabled", path: testInfo.outputPath("tools.png") });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Tools", exact: true })).toBeFocused();
      }
      await page.locator(".main").evaluate((node) => {
        node.scrollTop = 850;
      });
      expect(Math.abs((await controls.boundingBox())!.y - initialBox.y)).toBeLessThan(1);
      expect(
        await page.locator(".app").evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath("scrolled.png") });
    });
  }
}
