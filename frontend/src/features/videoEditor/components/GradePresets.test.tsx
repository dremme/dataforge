import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import * as api from "@/features/videoEditor/api/videoProjects";
import { restingAdjust } from "@/features/videoEditor/lib/timeline";
import { GradePresets } from "./GradePresets";
import type {
  deleteVideoProjectGrade,
  listVideoProjectGrades,
  saveVideoProjectGrade,
} from "@/features/videoEditor/api/videoProjects";
import type { ColorAdjust } from "@/shared/types";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  listVideoProjectGrades: vi.fn<typeof listVideoProjectGrades>(),
  saveVideoProjectGrade: vi.fn<typeof saveVideoProjectGrade>(),
  deleteVideoProjectGrade: vi.fn<typeof deleteVideoProjectGrade>(),
}));

const dusk = {
  id: "g1",
  name: "Dusk",
  adjust: { ...restingAdjust(), warmth: 0.4 },
  created_at: "",
};

describe("GradePresets", () => {
  beforeEach(() => {
    installMockBackend();
    vi.mocked(api.listVideoProjectGrades).mockResolvedValue({ grades: [dusk] });
    vi.mocked(api.saveVideoProjectGrade).mockResolvedValue(dusk);
  });

  it("applies a saved grade and saves the current one under a name", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn<(adjust: ColorAdjust) => void>();
    const current = { ...restingAdjust(), contrast: 0.2 };
    renderWithProviders(<GradePresets current={current} onApply={onApply} />);

    const pick = await screen.findByRole("combobox", { name: "Saved grade" });
    await waitFor(() => expect(pick).toBeEnabled());
    await user.selectOptions(pick, "g1");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(dusk.adjust);

    await user.click(screen.getByRole("button", { name: "Save this grade..." }));
    await user.type(screen.getByRole("textbox", { name: "Grade name" }), "Contrasty{Enter}");
    expect(api.saveVideoProjectGrade).toHaveBeenCalledWith("Contrasty", current);
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Grade name" })).not.toBeInTheDocument(),
    );
  });
});
