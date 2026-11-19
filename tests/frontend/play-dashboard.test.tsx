import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PlayDashboard } from "@/components/sessions/PlayDashboard";
import { createOrResumeSession } from "@/lib/client/session-api";
import { snapshot, sessionSummary } from "./session-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: vi.fn(),
}));
vi.mock("@/lib/client/session-api", () => ({ createOrResumeSession: vi.fn() }));
it("resumes the active saved session", () => {
  render(<PlayDashboard activeSession={sessionSummary()} />);
  expect(screen.getByRole("link", { name: /Resume session/ })).toHaveAttribute(
    "href",
    `/play/${snapshot().id}`,
  );
  expect(
    screen.queryByRole("button", { name: /Start/ }),
  ).not.toBeInTheDocument();
});
it("reuses the start request after a lost response", async () => {
  vi.mocked(createOrResumeSession)
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValueOnce({
      session: snapshot(),
      created: true,
      replayed: true,
    });
  const user = userEvent.setup();
  render(<PlayDashboard activeSession={null} />);
  await user.click(screen.getByRole("button", { name: /Start 3/ }));
  await user.click(
    await screen.findByRole("button", { name: /Retry opening/ }),
  );
  expect(vi.mocked(createOrResumeSession).mock.calls[0][0]).toEqual(
    vi.mocked(createOrResumeSession).mock.calls[1][0],
  );
  expect(router.push).toHaveBeenCalledWith(`/play/${snapshot().id}`);
});
