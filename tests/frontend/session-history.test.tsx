import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SessionHistory } from "@/components/sessions/SessionHistory";
import { listSessions } from "@/lib/client/session-api";
import { sessionSummary } from "./session-fixtures";
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: vi.fn(),
}));
vi.mock("@/lib/client/session-api", () => ({ listSessions: vi.fn() }));
it("shows the first-session empty state", () => {
  render(
    <SessionHistory initialHistory={{ sessions: [], nextCursor: null }} />,
  );
  expect(screen.getByRole("link", { name: /Start playing/ })).toBeVisible();
});
it("merges paginated history without duplicate sessions or accuracy labels", async () => {
  vi.mocked(listSessions).mockResolvedValueOnce({
    sessions: [
      sessionSummary(),
      {
        ...sessionSummary("completed"),
        id: "55555555-5555-4555-8555-555555555555",
      },
    ],
    nextCursor: null,
  });
  const user = userEvent.setup();
  render(
    <SessionHistory
      initialHistory={{ sessions: [sessionSummary()], nextCursor: "cursor" }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Load more sessions" }));
  expect(
    await screen.findByRole("link", { name: /Review session/ }),
  ).toBeVisible();
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.queryByText(/accuracy|rank/i)).not.toBeInTheDocument();
});
it("retains earlier sessions after a pagination error", async () => {
  vi.mocked(listSessions).mockRejectedValueOnce(new Error("Offline"));
  const user = userEvent.setup();
  render(
    <SessionHistory
      initialHistory={{ sessions: [sessionSummary()], nextCursor: "cursor" }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Load more sessions" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("link", { name: /Resume session/ })).toBeVisible();
});
