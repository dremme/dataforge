import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChanged } from "./useChanged";

function Draft({ value, commits }: { value: string; commits: string[] }) {
  const [draft, setDraft] = useState(value);
  if (useChanged(value)) setDraft(value);
  commits.push(draft);
  return <output>{draft}</output>;
}

describe("useChanged", () => {
  it("resets state in the render that sees the new value, never committing the old one", () => {
    const commits: string[] = [];
    const { rerender } = render(<Draft value="a" commits={commits} />);
    commits.length = 0;

    rerender(<Draft value="b" commits={commits} />);

    expect(screen.getByRole("status")).toHaveTextContent("b");
    expect(commits.at(-1)).toBe("b");
  });

  it("does not fire for the first render or an unchanged value", () => {
    const commits: string[] = [];
    const { rerender } = render(<Draft value="a" commits={commits} />);
    rerender(<Draft value="a" commits={commits} />);

    expect(new Set(commits)).toEqual(new Set(["a"]));
  });

  it("tracks function values without calling them", () => {
    let calls = 0;
    const seen: boolean[] = [];
    function Probe({ fn }: { fn: () => void }) {
      seen.push(useChanged(fn));
      return null;
    }
    const { rerender } = render(<Probe fn={() => calls++} />);
    rerender(<Probe fn={() => calls++} />);

    expect(calls).toBe(0);
    expect(seen).toContain(true);
  });
});
