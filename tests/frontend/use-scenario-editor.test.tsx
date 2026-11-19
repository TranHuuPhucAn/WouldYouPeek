import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScenarioEditor } from "@/hooks/use-scenario-editor";
import * as api from "@/lib/client/creator-api";
import { ApiClientError } from "@/lib/client/api-response";
import { creatorSnapshot, creatorId } from "./creator-fixtures";
vi.mock("@/lib/client/creator-api", () => ({
  saveCreatorScenario: vi.fn(),
  getCreatorScenario: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.mocked(api.saveCreatorScenario).mockReset().mockResolvedValue({
    scenario: creatorSnapshot(),
    replayed: false,
    publishedVersion: null,
  });
  vi.mocked(api.getCreatorScenario)
    .mockReset()
    .mockResolvedValue(creatorSnapshot());
});
function ready() {
  return renderHook(
    ({ viewerId }) => useScenarioEditor(creatorSnapshot(), viewerId),
    { initialProps: { viewerId: "owner" } },
  );
}
describe("creator editor request coordination", () => {
  it("deduplicates saves and preserves newer typing after a confirmed save", async () => {
    let resolve!: (
      v: Awaited<ReturnType<typeof api.saveCreatorScenario>>,
    ) => void;
    vi.mocked(api.saveCreatorScenario).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const { result } = ready();
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "First",
      }),
    );
    act(() => {
      void result.current.saveDraft();
      void result.current.saveDraft();
    });
    expect(api.saveCreatorScenario).toHaveBeenCalledTimes(1);
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "Second",
      }),
    );
    const saved = creatorSnapshot();
    saved.revision = 2;
    saved.draft.revision = 2;
    saved.draft.content.title = "First";
    await act(async () =>
      resolve({ scenario: saved, replayed: false, publishedVersion: null }),
    );
    expect(result.current.state.content.title).toBe("Second");
    expect(result.current.dirty).toBe(true);
  });
  it("retries the identical command UUID and content after a lost response", async () => {
    const confirmed = creatorSnapshot();
    confirmed.revision = 2;
    confirmed.draft.revision = 2;
    confirmed.draft.content.title = "First";
    vi.mocked(api.saveCreatorScenario)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({
        scenario: confirmed,
        replayed: true,
        publishedVersion: null,
      });
    const { result } = ready();
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "First",
      }),
    );
    await act(() => result.current.saveDraft());
    const original = vi.mocked(api.saveCreatorScenario).mock.calls[0][1];
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "Later",
      }),
    );
    await act(() => result.current.retrySave());
    expect(vi.mocked(api.saveCreatorScenario).mock.calls[1][1]).toEqual(
      original,
    );
    expect(original.content.title).toBe("First");
    expect(result.current.state.content.title).toBe("Later");
    expect(result.current.state.conflict).toBe(false);
  });
  it("preserves local text on conflict until the user explicitly loads latest", async () => {
    vi.mocked(api.saveCreatorScenario).mockRejectedValueOnce(
      new ApiClientError("SCENARIO_CONFLICT", "Changed", 409),
    );
    const latest = creatorSnapshot();
    latest.revision = 2;
    latest.draft.revision = 2;
    latest.draft.content.title = "Remote";
    vi.mocked(api.getCreatorScenario).mockResolvedValue(latest);
    const { result } = ready();
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "Local",
      }),
    );
    await act(() => result.current.saveDraft());
    expect(result.current.state.conflict).toBe(true);
    await act(() => result.current.saveDraft());
    expect(api.saveCreatorScenario).toHaveBeenCalledTimes(1);
    await act(() => result.current.fetchLatest());
    expect(result.current.state.content.title).toBe("Local");
    expect(result.current.state.latest?.draft.content.title).toBe("Remote");
    act(() => result.current.acceptLatest());
    expect(result.current.state.content.title).toBe("Remote");
    expect(result.current.dirty).toBe(false);
  });
  it.each([401, 403])("clears private editor data after %s", async (status) => {
    vi.mocked(api.saveCreatorScenario).mockRejectedValueOnce(
      new ApiClientError("AUTH_REQUIRED", "Expired", status),
    );
    const { result } = ready();
    await act(() => result.current.saveDraft());
    expect(result.current.state.invalid).toBe(true);
    expect(result.current.dirty).toBe(false);
    expect(result.current.state.content).toEqual({});
  });
  it("ignores a save response after identity invalidation", async () => {
    let resolve!: (
      v: Awaited<ReturnType<typeof api.saveCreatorScenario>>,
    ) => void;
    vi.mocked(api.saveCreatorScenario).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const { result } = ready();
    act(() => void result.current.saveDraft());
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    await act(async () =>
      resolve({
        scenario: creatorSnapshot(),
        replayed: false,
        publishedVersion: null,
      }),
    );
    expect(result.current.state.invalid).toBe(true);
    expect(result.current.state.command).toBeNull();
    expect(vi.mocked(api.saveCreatorScenario).mock.calls[0][2]?.aborted).toBe(
      true,
    );
  });
  it("aborts requests on unmount and changed viewer identity", () => {
    vi.mocked(api.saveCreatorScenario).mockImplementation(
      () => new Promise(() => {}),
    );
    const first = ready();
    act(() => void first.result.current.saveDraft());
    const signal = vi.mocked(api.saveCreatorScenario).mock.calls[0][2];
    first.unmount();
    expect(signal?.aborted).toBe(true);
    const next = ready();
    next.rerender({ viewerId: "another-owner" });
    expect(next.result.current.state.invalid).toBe(true);
  });
  it("keeps the same save recoverable when latest comparison fails", async () => {
    vi.mocked(api.saveCreatorScenario).mockRejectedValueOnce(
      new Error("Offline"),
    );
    vi.mocked(api.getCreatorScenario).mockRejectedValueOnce(
      new Error("Offline"),
    );
    const { result } = ready();
    await act(() => result.current.saveDraft());
    const command = result.current.state.command;
    await act(() => result.current.fetchLatest());
    expect(result.current.state.command).toEqual(command);
    expect(result.current.state.error).toMatch(/latest draft couldn’t load/);
    expect(api.getCreatorScenario).toHaveBeenCalledWith(
      creatorId,
      expect.any(AbortSignal),
    );
  });
});

describe("save recovery without lost typing or silent rebasing", () => {
  it("preserves spaces and list separators typed in flight while sending normalized text", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.saveCreatorScenario>>,
    ) => void;
    vi.mocked(api.saveCreatorScenario).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = ready();
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "  First  ",
        knownFacts: ["  Existing fact  "],
        source: {
          ...result.current.state.content.source,
          url: "https://youtu.be/_yPrykaB2nE?t=1705",
        },
      }),
    );
    act(() => {
      void result.current.saveDraft();
    });
    const sent = vi.mocked(api.saveCreatorScenario).mock.calls[0][1];
    expect(sent.content.title).toBe("First");
    expect(sent.content.knownFacts).toEqual(["Existing fact"]);
    expect(sent.content.source.url).toBe(
      "https://www.youtube.com/watch?v=_yPrykaB2nE",
    );
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: "  First   ",
        knownFacts: ["  Existing fact  ", ""],
      }),
    );
    const saved = creatorSnapshot();
    saved.revision = 2;
    saved.draft.revision = 2;
    saved.draft.content = structuredClone(sent.content);
    await act(async () =>
      resolve({ scenario: saved, replayed: false, publishedVersion: null }),
    );
    expect(result.current.state.content.title).toBe("  First   ");
    expect(result.current.state.content.knownFacts).toEqual([
      "  Existing fact  ",
      "",
    ]);
    expect(result.current.state.conflict).toBe(false);
  });

  it.each([false, true])(
    "requires explicit reconciliation after another tab edits a recovered save (fresh local typing: %s)",
    async (freshLocalTyping) => {
      vi.mocked(api.saveCreatorScenario).mockRejectedValueOnce(
        new Error("Response lost after commit"),
      );
      const { result } = ready();
      act(() =>
        result.current.update({
          ...result.current.state.content,
          title: "Saved by this tab",
        }),
      );
      await act(() => result.current.saveDraft());
      const originalCommand = vi.mocked(api.saveCreatorScenario).mock
        .calls[0][1];
      const otherTab = creatorSnapshot();
      otherTab.revision = 3;
      otherTab.draft.revision = 3;
      otherTab.draft.content = {
        ...originalCommand.content,
        context: "New context saved by the other tab",
      };
      vi.mocked(api.saveCreatorScenario).mockResolvedValueOnce({
        scenario: otherTab,
        replayed: true,
        publishedVersion: null,
      });
      if (freshLocalTyping)
        act(() =>
          result.current.update({
            ...result.current.state.content,
            question: "A newer local question",
          }),
        );
      const localBeforeRetry = structuredClone(result.current.state.content);
      await act(() => result.current.retrySave());
      expect(vi.mocked(api.saveCreatorScenario).mock.calls[1][1]).toEqual(
        originalCommand,
      );
      expect(result.current.state.content).toEqual(localBeforeRetry);
      expect(result.current.state.snapshot.revision).toBe(1);
      expect(result.current.state.conflict).toBe(true);
      expect(result.current.state.latest).toEqual(otherTab);
      expect(result.current.state.command).toBeNull();
      await act(() => result.current.saveDraft());
      expect(api.saveCreatorScenario).toHaveBeenCalledTimes(2);
      act(() => result.current.acceptLatest());
      expect(result.current.state.content.context).toBe(
        otherTab.draft.content.context,
      );
      expect(result.current.state.snapshot.revision).toBe(3);
      expect(result.current.state.conflict).toBe(false);
      act(() =>
        result.current.update({
          ...result.current.state.content,
          title: "Edited after comparison",
        }),
      );
      const afterComparison = structuredClone(otherTab);
      afterComparison.revision = 4;
      afterComparison.draft.revision = 4;
      afterComparison.draft.content.title = "Edited after comparison";
      vi.mocked(api.saveCreatorScenario).mockResolvedValueOnce({
        scenario: afterComparison,
        replayed: false,
        publishedVersion: null,
      });
      await act(() => result.current.saveDraft());
      const next = vi.mocked(api.saveCreatorScenario).mock.calls[2][1];
      expect(next.expectedRevision).toBe(3);
      expect(next.content.context).toBe(otherTab.draft.content.context);
      expect(next.requestId).not.toBe(originalCommand.requestId);
      expect(result.current.state.conflict).toBe(false);
    },
  );

  it("accepts later review metadata when the recovered content still matches the submitted save", async () => {
    vi.mocked(api.saveCreatorScenario).mockRejectedValueOnce(
      new Error("Response lost"),
    );
    const { result } = ready();
    await act(() => result.current.saveDraft());
    act(() =>
      result.current.update({
        ...result.current.state.content,
        title: `${result.current.state.content.title} `,
      }),
    );
    const reviewed = creatorSnapshot(true, true);
    vi.mocked(api.saveCreatorScenario).mockResolvedValueOnce({
      scenario: reviewed,
      replayed: true,
      publishedVersion: null,
    });
    await act(() => result.current.retrySave());
    expect(result.current.state.snapshot.review).toEqual(reviewed.review);
    expect(result.current.state.content.title).toBe(
      `${reviewed.draft.content.title} `,
    );
    expect(result.current.state.conflict).toBe(false);
  });
});
