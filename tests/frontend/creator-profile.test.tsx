import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { CreatorProfileForm } from "@/components/account/CreatorProfileForm";
import * as api from "@/lib/client/creator-profile-api";
import { ApiClientError } from "@/lib/client/api-response";
vi.mock("@/lib/client/creator-profile-api", () => ({
  getCreatorProfile: vi.fn(),
  saveCreatorProfile: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.saveCreatorProfile).mockImplementation(async (input) => ({
    profile: {
      displayName: input.displayName,
      revision: input.expectedRevision + 1,
    },
    replayed: false,
  }));
});
function setup() {
  return render(
    <CreatorProfileForm
      initial={{ displayName: null, revision: 0 }}
      viewerId="owner"
    />,
  );
}
describe("public creator credit", () => {
  it("requires a name, counts codepoints, normalizes whitespace and never falls back to email", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
    expect(api.saveCreatorProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("2–50");
    fireEvent.change(screen.getByLabelText("Public display name"), {
      target: { value: "  Coach\u0085Example  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
    await screen.findByText(/Public name saved/);
    expect(api.saveCreatorProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Coach Example",
        expectedRevision: 0,
      }),
      expect.any(AbortSignal),
    );
    expect(screen.getByLabelText("Public display name")).toHaveValue(
      "Coach Example",
    );
  });
  it("retries the same name command after a lost response while preserving later edits", async () => {
    vi.mocked(api.saveCreatorProfile).mockRejectedValueOnce(
      new Error("Offline"),
    );
    setup();
    fireEvent.change(screen.getByLabelText("Public display name"), {
      target: { value: "Original" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
    const retry = await screen.findByRole("button", {
      name: "Retry the same name save",
    });
    fireEvent.change(screen.getByLabelText("Public display name"), {
      target: { value: "Later edit" },
    });
    fireEvent.click(retry);
    await screen.findByText(/Public name saved/);
    expect(vi.mocked(api.saveCreatorProfile).mock.calls[1][0]).toEqual(
      vi.mocked(api.saveCreatorProfile).mock.calls[0][0],
    );
    expect(screen.getByLabelText("Public display name")).toHaveValue(
      "Later edit",
    );
  });
  it("keeps conflicting input until explicitly loading the current name and clears identity", async () => {
    vi.mocked(api.saveCreatorProfile).mockRejectedValueOnce(
      new ApiClientError(
        "CREATOR_PROFILE_CONFLICT",
        "Name changed elsewhere",
        409,
      ),
    );
    vi.mocked(api.getCreatorProfile).mockResolvedValue({
      displayName: "Elsewhere",
      revision: 4,
    });
    setup();
    fireEvent.change(screen.getByLabelText("Public display name"), {
      target: { value: "Local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save public name" }));
    const load = await screen.findByRole("button", {
      name: "Load current public name",
    });
    expect(screen.getByLabelText("Public display name")).toHaveValue("Local");
    fireEvent.click(load);
    await waitFor(() =>
      expect(screen.getByLabelText("Public display name")).toHaveValue(
        "Elsewhere",
      ),
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(
      screen.queryByLabelText("Public display name"),
    ).not.toBeInTheDocument();
  });
});
