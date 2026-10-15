import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaTagList } from "./MediaTagList";

const TAGS = ["dog", "beach", "sea", "sky"].map((label, index) => ({
  label,
  confidence: 0.9 - index * 0.1,
}));

/** jsdom lays nothing out, so tags named here stand in for the ones that wrapped. */
function wrapTags(...wrapped: string[]) {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const label = this.firstChild?.textContent ?? "";
    return this.tagName === "LI" && wrapped.includes(label) ? 24 : 0;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaTagList", () => {
  it("counts the tags that did not fit and names them in the tooltip", async () => {
    wrapTags("sea", "sky");

    render(<MediaTagList tags={TAGS} />);

    const more = screen.getByText("+2 more");
    await userEvent.setup().hover(more);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("sea, sky");
    // Every tag stays in the list for assistive tech, so the count is not announced twice.
    expect(more).toHaveAttribute("aria-hidden", "true");
    expect(
      within(screen.getByRole("group", { name: "Tags" })).getAllByRole("listitem"),
    ).toHaveLength(4);
  });

  it("shows no count when every tag fits", () => {
    wrapTags();

    render(<MediaTagList tags={TAGS} />);

    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });
});
