import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
import { answerFor, challenges, summaries } from "./fixtures";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  fetcher.mockReset().mockImplementation(async (url, init) => {
    const path = String(url);
    if (path === "/api/challenges")
      return Response.json({ challenges: summaries });
    const id = path.split("/")[3];
    if (init?.method === "POST")
      return Response.json(
        answerFor(id, JSON.parse(String(init.body)).optionId),
      );
    return Response.json(challenges.find((challenge) => challenge.id === id));
  });
  vi.stubGlobal("fetch", fetcher);
});

describe("complete player interactions", () => {
  it("plays all three challenges, keeps review read-only, shows recap, and restarts", async () => {
    const user = userEvent.setup();
    render(<ChallengePlayer />);
    for (let index = 0; index < 3; index++) {
      await screen.findByRole("heading", {
        level: 1,
        name: challenges[index].title,
      });
      expect(
        screen.queryByText("Make the opponent cross your angle."),
      ).not.toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: /Continue to decision/ }),
      );
      expect(
        screen.getByRole("heading", { name: "What’s your call?" }),
      ).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("button", { name: /Replay setup/ }),
      ).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("radio", { name: /Hold the angle/ }),
      ).toHaveFocus();
      expect(
        screen.getByRole("button", { name: /Lock in your call/ }),
      ).toBeDisabled();
      await user.click(screen.getByRole("radio", { name: /Hold the angle/ }));
      if (index === 0) {
        await user.click(screen.getByRole("button", { name: /Replay setup/ }));
        await user.click(
          screen.getByRole("button", { name: /Continue to decision/ }),
        );
        expect(
          screen.getByRole("radio", { name: /Hold the angle/ }),
        ).toBeChecked();
      }
      await user.click(
        screen.getByRole("button", { name: /Lock in your call/ }),
      );
      await screen.findByRole("region", { name: "Answer feedback" });
      expect(
        screen.getByText("Make the opponent cross your angle."),
      ).toBeVisible();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Setup" }));
      expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await user.click(screen.getByRole("button", { name: "Outcome" }));
      await user.click(
        screen.getByRole("button", {
          name: index === 2 ? /Finish session/ : /Next scenario/,
        }),
      );
    }
    expect(
      await screen.findByRole("heading", { level: 1, name: /Three calls/ }),
    ).toBeVisible();
    const recap = screen.getByText("Hold the advantage").closest("details")!;
    await user.click(within(recap).getByText("Hold the advantage"));
    expect(
      within(recap).getByText("Holding keeps your advantage."),
    ).toBeVisible();
    expect(document.querySelectorAll("details.recap-card")).toHaveLength(3);
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: /Play again/ }));
    await screen.findByRole("heading", {
      level: 1,
      name: "Hold the advantage",
    });
    expect(screen.getByLabelText("Scenario 1 of 3")).toBeVisible();
  });
  it("lets the player select by keyboard and blocks duplicate submissions while pending", async () => {
    let resolveAnswer!: (value: Response) => void;
    const normalFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      init?.method === "POST"
        ? new Promise((resolve) => {
            resolveAnswer = resolve;
          })
        : normalFetch(url, init),
    );
    const user = userEvent.setup();
    render(<ChallengePlayer />);
    await user.click(
      await screen.findByRole("button", { name: /Continue to decision/ }),
    );
    screen.getByRole("radio", { name: /Hold the angle/ }).focus();
    await user.keyboard(" ");
    expect(screen.getByRole("radio", { name: /Hold the angle/ })).toBeChecked();
    await user.dblClick(
      screen.getByRole("button", { name: /Lock in your call/ }),
    );
    expect(screen.getByRole("button", { name: /Submitting/ })).toBeDisabled();
    expect(
      screen.getByRole("radio", { name: /Hold the angle/ }),
    ).toBeDisabled();
    expect(
      screen.queryByText("Holding keeps your advantage."),
    ).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    resolveAnswer(Response.json(answerFor()));
    await screen.findByRole("region", { name: "Answer feedback" });
  });
  it("keeps a selected answer and permits retry after malformed feedback", async () => {
    const normalFetch = fetcher.getMockImplementation()!;
    let failed = false;
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === "POST" && !failed) {
        failed = true;
        return Response.json({ foo: "invalid" });
      }
      return normalFetch(url, init);
    });
    const user = userEvent.setup();
    render(<ChallengePlayer />);
    await user.click(
      await screen.findByRole("button", { name: /Continue to decision/ }),
    );
    await user.click(screen.getByRole("radio", { name: /Hold the angle/ }));
    await user.click(screen.getByRole("button", { name: /Lock in your call/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "response was incomplete",
    );
    expect(screen.getByRole("radio", { name: /Hold the angle/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /Lock in your call/ }));
    await screen.findByRole("region", { name: "Answer feedback" });
  });
  it("recovers from an initial loading failure", async () => {
    fetcher.mockRejectedValueOnce(new TypeError("Connection lost"));
    const user = userEvent.setup();
    render(<ChallengePlayer />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection lost",
    );
    await user.click(screen.getByRole("button", { name: "Retry loading" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Continue to decision/ }),
      ).toBeEnabled(),
    );
  });
});
