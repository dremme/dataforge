import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { BACKEND_UNREACHABLE, NetworkError } from "@/shared/api/http";
import { ServerEventsProvider } from "@/shared/events/ServerEventsProvider";
import { installFakeEventSource } from "@/test/fakeEventSource";
import { queryWrapper } from "@/test/queryClient";
import { BackendUnavailable } from "./BackendUnavailable";

function answering() {
  return vi.fn(async () => Response.json({ status: "ok" }));
}

function unreachable() {
  return vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
}

function FolderProbe({ read }: { read: () => Promise<string> }) {
  const { data } = useQuery({ queryKey: ["probe"], queryFn: read, retry: false });
  return data ? <p>{data}</p> : null;
}

function renderGate(read?: () => Promise<string>) {
  const { client, wrapper } = queryWrapper();
  render(
    <ServerEventsProvider>
      {read && <FolderProbe read={read} />}
      <BackendUnavailable />
    </ServerEventsProvider>,
    { wrapper },
  );
  return client;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackendUnavailable", () => {
  it("covers the app with the error while the API does not answer", async () => {
    installFakeEventSource();
    vi.stubGlobal("fetch", unreachable());

    renderGate();

    expect(await screen.findByRole("alert")).toHaveTextContent(BACKEND_UNREACHABLE.title);
  });

  it("keeps the error up while re-probing an API that never answered", async () => {
    installFakeEventSource();
    vi.stubGlobal("fetch", unreachable());
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(new NetworkError());
    const client = renderGate(read);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryState(["probe"])?.status).toBe("error"));

    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    act(() => void client.refetchQueries({ queryKey: ["health"] }));

    await waitFor(() => expect(client.getQueryState(["health"])?.fetchStatus).toBe("fetching"));
    expect(screen.getByRole("alert")).toHaveTextContent(BACKEND_UNREACHABLE.title);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way while the API answers, even with an error", async () => {
    installFakeEventSource();
    const fetchMock = vi.fn(async () => new Response("Not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    renderGate();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("re-probes when the event stream drops and lifts when it reconnects", async () => {
    const stream = installFakeEventSource();
    vi.stubGlobal("fetch", answering());
    const client = renderGate();
    act(() => stream.open());
    await waitFor(() => expect(client.getQueryState(["health"])?.status).toBe("success"));

    vi.stubGlobal("fetch", unreachable());
    act(() => stream.source().onerror?.());
    expect(await screen.findByRole("alert")).toHaveTextContent(BACKEND_UNREACHABLE.title);

    vi.stubGlobal("fetch", answering());
    act(() => stream.open());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("re-reads whatever failed to reach the API once it answers again", async () => {
    const stream = installFakeEventSource();
    vi.stubGlobal("fetch", unreachable());
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValue("Folder contents");
    renderGate(read);
    expect(await screen.findByRole("alert")).toHaveTextContent(BACKEND_UNREACHABLE.title);

    vi.stubGlobal("fetch", answering());
    act(() => stream.open());

    expect(await screen.findByText("Folder contents")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
