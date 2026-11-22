import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useScenarioReport } from "@/hooks/use-scenario-report";
import { viewer, snapshot } from "./session-fixtures";
import { receipt } from "./moderation-fixtures";
const target = {
  kind: "session-item" as const,
  sessionId: snapshot().id,
  itemId: snapshot().items[0].id,
};
it("coalesces double submits and keeps a frozen target while the command is uncertain", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json(receipt({ duplicate: true })));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useScenarioReport(viewer.id));
  act(() => result.current.begin(target));
  act(() => result.current.setDetail("Original details"));
  await act(async () => {
    await Promise.all([result.current.submit(), result.current.submit()]);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  act(() => result.current.close());
  act(() =>
    result.current.begin({ ...target, itemId: snapshot().items[1].id }),
  );
  expect(result.current.target).toEqual(target);
  expect(result.current.detail).toBe("Original details");
  await act(async () => result.current.retry());
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  expect(result.current.receipt?.duplicate).toBe(true);
});
it("allows a new command after a rate rejection without erasing the form", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: "RATE_LIMITED", message: "Wait" } },
        { status: 429 },
      ),
    )
    .mockResolvedValueOnce(Response.json(receipt()));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useScenarioReport(viewer.id));
  act(() => result.current.begin(target));
  act(() => result.current.setDetail("Keep this"));
  await act(async () => result.current.submit());
  expect(result.current.unresolved).toBe(false);
  expect(result.current.detail).toBe("Keep this");
  expect(result.current.error).toMatch(/report limit/);
  await act(async () => result.current.submit());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).requestId).not.toBe(
    JSON.parse(fetcher.mock.calls[1][1].body).requestId,
  );
});
it("aborts on unmount and clears private data if the component receives another account", async () => {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((r) => {
        respond = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = renderHook(({ id }) => useScenarioReport(id), {
    initialProps: { id: viewer.id },
  });
  act(() => view.result.current.begin(target));
  act(() => view.result.current.setDetail("Private"));
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.submit()!;
  });
  view.rerender({ id: "another-viewer" });
  await act(async () => {
    respond(Response.json(receipt()));
    await pending;
  });
  expect(view.result.current.invalid).toBe(true);
  expect(view.result.current.detail).toBe("");
  expect(view.result.current.receipt).toBeNull();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  view.unmount();
});
