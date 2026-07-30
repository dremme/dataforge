import { afterEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock("@/shared/api/http", () => ({
  requestJson: requestJsonMock,
}));

import { fetchSystemSpecs } from "./system";

describe("system API", () => {
  afterEach(() => {
    requestJsonMock.mockReset();
  });

  it("fetches system specs", async () => {
    const specs = {
      cpu_name: "Intel Core i7-12700K",
      cpu_cores: 16,
      memory_total_bytes: 32 * 1024 ** 3,
      memory_used_bytes: 8 * 1024 ** 3,
      gpu_name: "NVIDIA GeForce RTX 3080",
      gpu_memory_bytes: 10 * 1024 ** 3,
      gpu_memory_used_bytes: 4 * 1024 ** 3,
      gpu_available: true,
    };
    requestJsonMock.mockResolvedValue(specs);

    await expect(fetchSystemSpecs()).resolves.toEqual(specs);
    expect(requestJsonMock).toHaveBeenCalledWith("/api/system/specs");
  });
});
