import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AccountPanel } from "@/components/account/AccountPanel";
import { enableCreatorAccess } from "@/lib/client/account-api";
import { viewer } from "./session-fixtures";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/(auth)/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: vi.fn(),
}));
vi.mock("@/lib/client/account-api", () => ({ enableCreatorAccess: vi.fn() }));
it("waits for enrollment confirmation and preserves learner access", async () => {
  let resolve!: (
    value: Awaited<ReturnType<typeof enableCreatorAccess>>,
  ) => void;
  vi.mocked(enableCreatorAccess).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  const user = userEvent.setup();
  render(<AccountPanel viewer={viewer} />);
  await user.click(
    screen.getByRole("button", { name: "Enable creator access" }),
  );
  expect(
    screen.queryByRole("link", { name: /Open creator/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enabling…" })).toBeDisabled();
  resolve({ ...viewer, role: "creator", capabilities: ["learn", "create"] });
  expect(
    await screen.findByRole("link", { name: /Open creator/ }),
  ).toBeVisible();
  expect(screen.getByText(/Creator and learner/)).toBeVisible();
  expect(
    screen.getByText(
      /review every choice, and publish it to the learner library/,
    ),
  ).toBeVisible();
});
it("offers retry without optimistic role change after failure", async () => {
  vi.mocked(enableCreatorAccess).mockRejectedValueOnce(new Error("Offline"));
  const user = userEvent.setup();
  render(<AccountPanel viewer={viewer} />);
  await user.click(
    screen.getByRole("button", { name: "Enable creator access" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("try again");
  expect(
    screen.queryByRole("link", { name: /Open creator/ }),
  ).not.toBeInTheDocument();
});
it("only exposes operator access from its separate verified membership flag", () => {
  const view = render(
    <AccountPanel
      viewer={{ ...viewer, role: "creator", capabilities: ["learn", "create"] }}
    />,
  );
  expect(
    screen.queryByRole("link", { name: /Review scenario reports/ }),
  ).not.toBeInTheDocument();
  view.rerender(<AccountPanel viewer={viewer} operatorAccess />);
  expect(
    screen.getByRole("link", { name: /Review scenario reports/ }),
  ).toHaveAttribute("href", "/operator/reports");
  view.rerender(
    <AccountPanel
      viewer={{ ...viewer, emailVerified: false }}
      operatorAccess
    />,
  );
  expect(
    screen.queryByRole("link", { name: /Review scenario reports/ }),
  ).not.toBeInTheDocument();
});
