import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioEditor } from "@/components/creator/ScenarioEditor";
import { DecisionFields } from "@/components/creator/DecisionFields";
import { AnalysisFields } from "@/components/creator/AnalysisFields";
import { useState } from "react";
import * as api from "@/lib/client/creator-api";
import { creatorSnapshot, validContent } from "./creator-fixtures";
vi.mock("@/lib/client/creator-api", () => ({
  saveCreatorScenario: vi.fn(),
  getCreatorScenario: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.mocked(api.saveCreatorScenario)
    .mockReset()
    .mockImplementation(async (_id, input) => {
      const s = creatorSnapshot();
      s.draft.content = input.content;
      s.revision = 2;
      s.draft.revision = 2;
      return { scenario: s, replayed: false, publishedVersion: null };
    });
  vi.mocked(api.getCreatorScenario).mockReset();
});
describe("complete explicit-save creator editor", () => {
  it("explains the known-fact review requirement while keeping other lists optional", () => {
    render(<ScenarioEditor initial={creatorSnapshot()} viewerId="owner" />);
    expect(screen.getByLabelText("Known facts")).toHaveAccessibleDescription(
      expect.stringContaining(
        "Add at least one player-visible fact before review or publication",
      ),
    );
    expect(screen.getByLabelText("Known facts")).toHaveAccessibleDescription(
      expect.stringContaining("You can save an incomplete draft without one"),
    );
    for (const label of [
      "Unknown information",
      "Analysis limitations",
      "Choice 1 risks",
      "Choice 1: defensible when",
    ])
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
        expect.stringContaining(
          "Leave empty when there are no additional entries",
        ),
      );
  });
  it("saves incomplete work explicitly, without requiring publication fields", async () => {
    render(
      <ScenarioEditor initial={creatorSnapshot(false)} viewerId="owner" />,
    );
    expect(api.saveCreatorScenario).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Scenario title"), {
      target: { value: "Unfinished moment" },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Review saved/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() =>
      expect(api.saveCreatorScenario).toHaveBeenCalledTimes(1),
    );
    expect(
      vi.mocked(api.saveCreatorScenario).mock.calls[0][1].content.title,
    ).toBe("Unfinished moment");
    expect(
      screen.getByRole("heading", { name: "Saved drafts can be incomplete" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Review saved/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Publish scenario" }),
    ).not.toBeInTheDocument();
  });
  it("shows accessible timestamp errors and blocks malformed input without losing text", () => {
    render(<ScenarioEditor initial={creatorSnapshot()} viewerId="owner" />);
    const input = screen.getByLabelText("Decision pause");
    fireEvent.change(input, { target: { value: "not a time" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    expect(api.saveCreatorScenario).not.toHaveBeenCalled();
    expect(input).toHaveValue("not a time");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(input.getAttribute("aria-describedby")).toContain(
      "creator-media-decisionSeconds-error",
    );
  });
  it("guards unsaved navigation and unload, and permits leaving after confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ScenarioEditor initial={creatorSnapshot()} viewerId="owner" />);
    fireEvent.change(screen.getByLabelText("Scenario title"), {
      target: { value: "Edited" },
    });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const link = screen.getByRole("link", { name: "← Creator workspace" });
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("unsaved changes"),
    );
  });
  it("renders text safely and hides all private fields after sign-out", () => {
    const s = creatorSnapshot();
    s.draft.content.title = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <ScenarioEditor initial={s} viewerId="owner" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Scenario title")).toHaveValue(
      s.draft.content.title,
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(screen.queryByLabelText("Scenario title")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Your creator session has changed.",
      }),
    ).toBeInTheDocument();
  });
  it("labels list-item validation at the actual list field", () => {
    const s = creatorSnapshot();
    s.draft.content.knownFacts = ["x".repeat(301)];
    render(<ScenarioEditor initial={s} viewerId="owner" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    const field = screen.getByLabelText("Known facts");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(api.saveCreatorScenario).not.toHaveBeenCalled();
  });
});
describe("stable choice identities", () => {
  function Fields() {
    const [content, setContent] = useState(validContent());
    return (
      <>
        <DecisionFields content={content} onChange={setContent} issues={[]} />
        <AnalysisFields content={content} onChange={setContent} issues={[]} />
        <output aria-label="choice identities">
          {JSON.stringify(content.options.map((o) => o.id))}
        </output>
      </>
    );
  }
  it("retains IDs across reorder and label edits, and clears a removed observed choice", () => {
    render(<Fields />);
    const original = validContent().options.map((o) => o.id);
    fireEvent.click(screen.getByRole("button", { name: "Move choice 1 down" }));
    expect(
      JSON.parse(screen.getByLabelText("choice identities").textContent!),
    ).toEqual([original[1], original[0], original[2]]);
    expect(screen.getByLabelText("Observed pro choice")).toHaveValue(
      original[0],
    );
    fireEvent.change(screen.getByLabelText("Choice 2 label"), {
      target: { value: "Renamed" },
    });
    expect(screen.getByLabelText("Observed pro choice")).toHaveValue(
      original[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove choice 2" }));
    expect(screen.getByLabelText("Observed pro choice")).toHaveValue("");
    expect(
      JSON.parse(screen.getByLabelText("choice identities").textContent!),
    ).toEqual([original[1], original[2]]);
  });
  it("adds independent UUID choices, stops at five and preserves every assessment editor", () => {
    render(<Fields />);
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    expect(screen.getByRole("button", { name: "Add choice" })).toBeDisabled();
    const ids = JSON.parse(
      screen.getByLabelText("choice identities").textContent!,
    );
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids[4]).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      within(screen.getByRole("region", { name: "Choice 5" })).getByLabelText(
        "Choice 5 assessment",
      ),
    ).toBeInTheDocument();
  });
});
