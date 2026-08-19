import { StrictMode, type ReactNode } from "react";
import { renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDuplicateGroups } from "@/features/gallery/api/duplicates";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import type { DuplicateGroup, DuplicateGroupsResponse } from "@/shared/types";
import { HOME_PATH, mediaItem } from "@/test/fixtures";
import { useDuplicateResolverOverlay } from "./useDuplicateResolverOverlay";

vi.mock("@/features/gallery/api/duplicates", () => ({
  fetchDuplicateGroups: vi.fn(),
}));

const fetchGroups = vi.mocked(fetchDuplicateGroups);

function group(id: string): DuplicateGroup {
  return {
    group: id,
    max_distance: 0,
    threshold: "exact",
    members: ["one.png", "two.png"].map((name) =>
      mediaItem(`${id}-${name}`, HOME_PATH, { has_duplicate_file: true, duplicate_group: id }),
    ),
  };
}

function listing(overrides: Partial<DuplicateGroupsResponse> = {}): DuplicateGroupsResponse {
  return {
    folder: HOME_PATH,
    groups: [group("g1")],
    stale: [],
    deletes_to_trash: true,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <NotificationsProvider>{children}</NotificationsProvider>
    </StrictMode>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchGroups.mockResolvedValue(listing());
});

describe("useDuplicateResolverOverlay", () => {
  it("opens on the group the card was flagged with", async () => {
    fetchGroups.mockResolvedValue(listing({ groups: [group("g1"), group("g2")] }));
    const { result } = renderHook(() => useDuplicateResolverOverlay(), { wrapper });

    await result.current.openDuplicateResolver(HOME_PATH, "g2");

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.index).toBe(1);
    // Nothing to announce: the modal is the feedback.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says so rather than opening on nothing when every finding lost its partner", async () => {
    // What a folder looks like when flagged files have outlived their groups: the
    // sidecars still count toward the toolbar, but no group has two live members.
    fetchGroups.mockResolvedValue(listing({ groups: [], stale: ["gone.png", "also-gone.png"] }));
    const { result } = renderHook(() => useDuplicateResolverOverlay(), { wrapper });

    await result.current.openDuplicateResolver(HOME_PATH);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 duplicate findings have no partner left to compare.",
    );
    expect(result.current.open).toBe(false);
  });

  it("leaves the findings alone, because the job is what rebuilds them", async () => {
    fetchGroups.mockResolvedValue(listing({ groups: [], stale: ["gone.png"] }));
    const onResolved = vi.fn();
    const { result } = renderHook(() => useDuplicateResolverOverlay(onResolved), { wrapper });

    await result.current.openDuplicateResolver(HOME_PATH);

    // Nothing was written or deleted, so there is nothing for the listing to catch up on.
    expect(onResolved).not.toHaveBeenCalled();
    expect(result.current.groups).toEqual([]);
  });

  it("still opens on the groups that are left when only some findings are spent", async () => {
    fetchGroups.mockResolvedValue(listing({ stale: ["gone.png"] }));
    const { result } = renderHook(() => useDuplicateResolverOverlay(), { wrapper });

    await result.current.openDuplicateResolver(HOME_PATH);

    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.groups).toHaveLength(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports an empty folder instead of failing silently", async () => {
    fetchGroups.mockResolvedValue(listing({ groups: [] }));
    const { result } = renderHook(() => useDuplicateResolverOverlay(), { wrapper });

    await result.current.openDuplicateResolver(HOME_PATH);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "No duplicate groups left in this folder.",
    );
    expect(result.current.open).toBe(false);
  });

  it("reports a failed fetch instead of failing silently", async () => {
    fetchGroups.mockRejectedValue(new Error("Backend unreachable"));
    const { result } = renderHook(() => useDuplicateResolverOverlay(), { wrapper });

    await result.current.openDuplicateResolver(HOME_PATH);

    expect(await screen.findByRole("alert")).toHaveTextContent("Backend unreachable");
    expect(result.current.open).toBe(false);
  });
});
