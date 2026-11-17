import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AuthStateSync } from "@/components/auth/AuthStateSync";
import { getAccount } from "@/lib/client/account-api";
import { ApiClientError } from "@/lib/client/api-response";
import { viewer } from "./session-fixtures";
const auth = vi.hoisted(() => ({
  callback: null as
    null | ((event: string, session: { user: { id: string } } | null) => void),
  unsubscribe: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: auth.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (callback: typeof auth.callback) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  }),
}));
vi.mock("@/lib/client/account-api", () => ({ getAccount: vi.fn() }));
it("unmounts old account content before refreshing after cross-tab logout", () => {
  render(
    <AuthStateSync viewerId={viewer.id}>
      <p>Private review</p>
    </AuthStateSync>,
  );
  act(() => auth.callback?.("SIGNED_OUT", null));
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  expect(auth.refresh).toHaveBeenCalled();
});
it("invalidates immediately when another account signs in and unsubscribes", () => {
  const view = render(
    <AuthStateSync viewerId={viewer.id}>
      <p>Private review</p>
    </AuthStateSync>,
  );
  act(() => auth.callback?.("SIGNED_IN", { user: { id: "another-user" } }));
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  view.unmount();
  expect(auth.unsubscribe).toHaveBeenCalled();
});
it("rechecks expired identity on tab return", async () => {
  vi.mocked(getAccount).mockRejectedValueOnce(
    new ApiClientError("AUTH_REQUIRED", "Expired", 401),
  );
  render(
    <AuthStateSync viewerId={viewer.id}>
      <p>Private review</p>
    </AuthStateSync>,
  );
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
});

it("keeps invalid account content hidden until a fresh server identity snapshot", () => {
  const view = render(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="first">
      <p>Private review</p>
    </AuthStateSync>,
  );
  act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
  view.rerender(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="first">
      <p>Private review</p>
    </AuthStateSync>,
  );
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  view.rerender(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="confirmed-refresh">
      <p>Fresh saved review</p>
    </AuthStateSync>,
  );
  expect(screen.getByText("Fresh saved review")).toBeVisible();
});

it("does not restore the previous account if a refresh races with sign-out", () => {
  const view = render(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="first">
      <p>Private review</p>
    </AuthStateSync>,
  );
  act(() => auth.callback?.("SIGNED_OUT", null));
  view.rerender(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="stale-refresh">
      <p>Private review</p>
    </AuthStateSync>,
  );
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  view.rerender(
    <AuthStateSync viewerId={null} authSnapshotKey="signed-out">
      <p>Public demo</p>
    </AuthStateSync>,
  );
  expect(screen.getByText("Public demo")).toBeVisible();
});

it.each(["INITIAL_SESSION", "SIGNED_IN"])(
  "keeps server-rendered sign-in usable when %s contains a deleted account",
  async (event) => {
    vi.mocked(getAccount).mockRejectedValueOnce(
      new ApiClientError("AUTH_REQUIRED", "Expired", 401),
    );
    const view = render(
      <AuthStateSync viewerId={null} authSnapshotKey="guest">
        <form aria-label="Sign in">
          <input aria-label="Email" />
        </form>
      </AuthStateSync>,
    );
    await act(async () =>
      auth.callback?.(event, { user: { id: "deleted-user" } }),
    );
    expect(screen.getByRole("form", { name: "Sign in" })).toBeVisible();
    expect(auth.refresh).not.toHaveBeenCalled();
    view.rerender(
      <AuthStateSync viewerId={null} authSnapshotKey="fresh-guest">
        <form aria-label="Sign in">
          <input aria-label="Email" />
        </form>
      </AuthStateSync>,
    );
    expect(screen.getByLabelText("Email")).toBeVisible();
    expect(
      screen.queryByText("Your sign-in has changed."),
    ).not.toBeInTheDocument();
  },
);

it("does not adopt a stale browser ID when the server verifies a different account", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce(viewer);
  const view = render(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="first">
      <p>Private review</p>
    </AuthStateSync>,
  );
  await act(async () =>
    auth.callback?.("INITIAL_SESSION", { user: { id: "stale-browser-user" } }),
  );
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
  view.rerender(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="confirmed-server">
      <p>Fresh saved review</p>
    </AuthStateSync>,
  );
  expect(screen.getByText("Fresh saved review")).toBeVisible();
});

it("ignores a stale initial reconciliation after a newer logout", async () => {
  let resolve!: (account: typeof viewer) => void;
  vi.mocked(getAccount).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  const view = render(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="first">
      <p>Private review</p>
    </AuthStateSync>,
  );
  act(() =>
    auth.callback?.("INITIAL_SESSION", { user: { id: "stale-browser-user" } }),
  );
  act(() => auth.callback?.("SIGNED_OUT", null));
  await act(async () => resolve(viewer));
  view.rerender(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="stale-refresh">
      <p>Private review</p>
    </AuthStateSync>,
  );
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
});

it("a logout request cancels earlier browser identity reconciliation", async () => {
  let resolve!: (account: typeof viewer) => void;
  vi.mocked(getAccount).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  const view = render(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="first">
      <p>Private review</p>
    </AuthStateSync>,
  );
  act(() =>
    auth.callback?.("INITIAL_SESSION", { user: { id: "stale-browser-user" } }),
  );
  act(() =>
    window.dispatchEvent(
      new CustomEvent("wyp:identity-invalidated", {
        detail: { expectedViewerId: null },
      }),
    ),
  );
  await act(async () => resolve(viewer));
  view.rerender(
    <AuthStateSync viewerId={viewer.id} authSnapshotKey="stale-refresh">
      <p>Private review</p>
    </AuthStateSync>,
  );
  expect(screen.queryByText("Private review")).not.toBeInTheDocument();
});
