import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { touchRecentFolder } from "@/features/folder/lib/folderPreferences";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SettingsModal } from "./SettingsModal";

let backend: ReturnType<typeof installMockBackend>;

beforeEach(() => {
  backend = installMockBackend();
});

async function openSection(section: string) {
  const user = userEvent.setup();
  renderWithProviders(<SettingsModal onClose={vi.fn()} />);
  await screen.findByRole("textbox", { name: "Server URL", hidden: true });
  await user.click(screen.getByRole("tab", { name: new RegExp(`^${section}`) }));
  return user;
}

const groupNamed = (name: string) => screen.getByRole("region", { name });

describe("SettingsModal sections", () => {
  it("tests the typed address and key, then offers the reported models", async () => {
    const user = await openSection("Vision model");
    const connection = groupNamed("Connection");

    await user.type(within(connection).getByLabelText("API key"), "sk-typed");
    await user.click(within(connection).getByRole("button", { name: "Test connection" }));

    expect(await within(connection).findByRole("status")).toHaveTextContent(
      "Reachable, 2 models: gemma4, qwen38",
    );
    const [[, init]] = backend.requestsTo("/api/settings/probe", "POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      service: "vision",
      base_url: "http://127.0.0.1:8888/v1",
      api_key: "sk-typed",
    });
    const model = within(connection).getByRole("combobox", { name: "Model" });
    const options = [...(model as HTMLInputElement).list!.options].map((option) => option.value);
    expect(options).toEqual(["gemma4", "qwen38"]);
  });

  it("drops a test result once its address changes", async () => {
    const user = await openSection("Integrations");
    const comfy = groupNamed("ComfyUI");

    await user.click(within(comfy).getByRole("button", { name: "Test connection" }));
    expect(await within(comfy).findByRole("status")).toHaveTextContent("Reachable");

    await user.type(within(comfy).getByRole("textbox", { name: "ComfyUI URL" }), "0");

    expect(within(comfy).queryByRole("status")).not.toBeInTheDocument();
  });

  it("never shows a saved key, and says whether one is set", async () => {
    await backend.fetchMock.getMockImplementation()!("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ vision_api_key: "sk-saved" }),
    });
    await openSection("Vision model");

    const key = screen.getByLabelText("API key");
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("placeholder", "Saved key is hidden");
    expect(key).toHaveAccessibleDescription("Saved Overrides the default");
  });

  it("puts the two sampling modes side by side, as numbers within their range", async () => {
    const user = await openSection("Vision model");
    await user.click(screen.getByRole("tab", { name: "Sampling" }));

    const reasoning = within(groupNamed("Reasoning")).getByRole("spinbutton", {
      name: "Temperature",
    });
    expect(reasoning).toHaveValue(1);
    expect(reasoning).toHaveAttribute("min", "0");
    expect(reasoning).toHaveAttribute("max", "2");
    expect(reasoning).toHaveAttribute("step", "0.05");
    expect(
      within(groupNamed("Instruct")).getByRole("spinbutton", { name: "Temperature" }),
    ).toHaveValue(0.7);
  });

  it("clears each kind of remembered data and says so", async () => {
    touchRecentFolder("C:\\Photos\\Lakes");
    const user = await openSection("Data & history");
    const remembered = groupNamed("Remembered data");
    const row = (label: string) => within(remembered).getByText(label).closest("li")!;

    await within(remembered).findByText("3 folders");
    expect(within(row("Recent folders")).getByText("1 folder")).toBeInTheDocument();

    await user.click(within(row("Recent folders")).getByRole("button", { name: "Clear" }));
    await user.click(within(row("Job options per folder")).getByRole("button", { name: "Clear" }));

    expect(await screen.findByText("Job options per folder cleared.")).toBeInTheDocument();
    expect(within(row("Recent folders")).getByText("0 folders")).toBeInTheDocument();
    expect(within(row("Job options per folder")).getByText("0 folders")).toBeInTheDocument();
    expect(within(row("Display modes per folder")).getByText("2 folders")).toBeInTheDocument();
    expect(localStorage.getItem("gallery-recent-folders")).toBe("[]");
  });

  it("describes the installation and copies diagnostics without the key", async () => {
    const user = await openSection("About");
    const installation = groupNamed("Installation");

    expect(await within(installation).findByText("DataForge 0.1.0")).toBeInTheDocument();
    expect(
      within(installation).getByText("C:\\ffmpeg\\bin\\ffmpeg.exe (from PATH)"),
    ).toBeInTheDocument();

    await user.click(within(installation).getByRole("button", { name: "Copy diagnostics" }));

    await waitFor(() =>
      expect(within(installation).getByRole("button", { name: "Copied!" })).toBeInTheDocument(),
    );
    const text = await navigator.clipboard.readText();
    expect(text).toContain("DataForge 0.1.0");
    expect(text).toContain("key not set");
    expect(text).not.toContain("sk-");
  });
});
