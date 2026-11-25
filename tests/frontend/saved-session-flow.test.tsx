import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
import { snapshot, viewer } from "./session-fixtures";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
it("withholds reveal during uncertain saves, retries the same command, and restores the review after reload", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(
      Response.json({ session: snapshot("review"), replayed: true }),
    );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  const view = render(
    <ChallengePlayer initialSession={snapshot()} viewer={viewer} />,
  );
  await user.click(
    screen.getByRole("button", { name: /Continue to decision/ }),
  );
  await user.click(screen.getByRole("radio", { name: "Hold the angle" }));
  await user.click(screen.getByRole("button", { name: /Lock in your call/ }));
  expect(
    screen.queryByRole("region", { name: "Answer feedback" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByAltText("Outcome diagram")).not.toBeInTheDocument();
  await act(async () =>
    resolve(new Response("Connection lost", { status: 503 })),
  );
  await user.click(await screen.findByRole("button", { name: "Retry save" }));
  expect(
    screen.queryByRole("region", { name: "Answer feedback" }),
  ).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole("button", { name: /Read analysis/ }),
  );
  expect(
    await screen.findByRole("region", { name: "Answer feedback" }),
  ).toBeVisible();
  expect(fetcher.mock.calls[2][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
  view.unmount();
  render(
    <ChallengePlayer initialSession={snapshot("review")} viewer={viewer} />,
  );
  expect(screen.getByRole("region", { name: "Answer feedback" })).toBeVisible();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("removes private media and rejects late save results on identity expiry", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => new Promise((r) => (resolve = r)));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ChallengePlayer initialSession={snapshot()} viewer={viewer} />);
  await user.click(
    screen.getByRole("button", { name: /Continue to decision/ }),
  );
  await user.click(screen.getByRole("radio", { name: "Hold the angle" }));
  await user.click(screen.getByRole("button", { name: /Lock in your call/ }));
  act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
  expect(
    screen.getByRole("heading", { name: "Sign in to continue." }),
  ).toBeVisible();
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () =>
    resolve(Response.json({ session: snapshot("review"), replayed: false })),
  );
  expect(
    screen.queryByRole("region", { name: "Answer feedback" }),
  ).not.toBeInTheDocument();
});
