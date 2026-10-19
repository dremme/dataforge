import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DialogShell } from "@/shared/ui/DialogShell";
import { NotificationContainer } from "./NotificationContainer";

function Feedback() {
  return (
    <NotificationContainer
      toasts={[
        { id: "saved", message: "Changes saved", variant: "success", count: 1, durationMs: 4000 },
      ]}
      onDismiss={vi.fn<(id: string) => void>()}
      onRemove={vi.fn<(id: string) => void>()}
      onPauseAutoDismiss={vi.fn<(id: string) => void>()}
      onResumeAutoDismiss={vi.fn<(id: string) => void>()}
    />
  );
}

it("places feedback in the top modal when a parent and child mount together", async () => {
  render(
    <DialogShell block="parent-dialog" label="Parent" onClose={() => {}}>
      <DialogShell block="child-dialog" label="Child" onClose={() => {}}>
        <Feedback />
      </DialogShell>
    </DialogShell>,
  );
  await waitFor(() =>
    expect(screen.getByRole("status").closest("dialog")).toBe(
      screen.getByRole("dialog", { name: "Child" }),
    ),
  );
});

it("keeps feedback inside an open modal and returns it to the page when the modal closes", async () => {
  function Fixture({ open }: { open: boolean }) {
    return (
      <>
        {open && (
          <DialogShell block="test-dialog" label="Editor" onClose={() => {}}>
            <button type="button">Save</button>
          </DialogShell>
        )}
        <Feedback />
      </>
    );
  }
  const { rerender } = render(<Fixture open={false} />);
  expect(screen.getByRole("status").closest("dialog")).toBeNull();

  rerender(<Fixture open />);
  await waitFor(() =>
    expect(screen.getByRole("status").closest("dialog")).toBe(screen.getByRole("dialog")),
  );

  rerender(<Fixture open={false} />);
  await waitFor(() => expect(screen.getByRole("status").closest("dialog")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent("Changes saved");
});
