import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type {
  VideoBounds,
  YouTubeEvents,
  YouTubePlayer,
} from "@/lib/video/youtube-api";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
import {
  getChallenge,
  listChallenges,
  submitAnswer,
} from "../fixtures/authored-challenges";

vi.mock("server-only", () => ({}));
import { snapshot, viewer } from "./session-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: vi.fn(),
}));

const provider = vi.hoisted(() => ({
  instances: [] as Array<{
    player: YouTubePlayer;
    events: YouTubeEvents;
    time: number;
    state: number;
    bounds: VideoBounds;
  }>,
}));

vi.mock("@/lib/video/youtube-api", () => ({
  loadYouTubeApi: vi.fn(async () => ({})),
  describeYouTubeError: () => "Playback failed.",
  createYouTubePlayer: vi.fn(
    (
      _api,
      element: HTMLElement,
      bounds: VideoBounds,
      events: YouTubeEvents,
    ) => {
      const frame = document.createElement("iframe");
      element.replaceWith(frame);
      const instance = {
        player: {} as YouTubePlayer,
        events,
        time: bounds.startSeconds,
        state: 5,
        bounds,
      };
      function state(next: number) {
        instance.state = next;
        events.onStateChange({ target: instance.player, data: next });
      }
      instance.player = {
        cueVideoById: vi.fn((next: VideoBounds) => {
          instance.bounds = next;
          instance.time = next.startSeconds;
          state(5);
        }),
        loadVideoById: vi.fn((next: VideoBounds) => {
          instance.bounds = next;
          instance.time = next.startSeconds;
          state(1);
        }),
        playVideo: vi.fn(() => state(1)),
        pauseVideo: vi.fn(() => state(2)),
        seekTo: vi.fn((time: number) => {
          instance.time = time;
        }),
        getCurrentTime: () => instance.time,
        getPlayerState: () => instance.state,
        getIframe: () => frame,
        destroy: vi.fn(() => frame.remove()),
      };
      provider.instances.push(instance);
      queueMicrotask(() => events.onReady({ target: instance.player }));
      return instance.player;
    },
  ),
}));

it("completes the actual three-VOD catalogue with persistent decisions, replay, comparison, recap and reset", async () => {
  provider.instances.length = 0;
  let canonical = snapshot();
  canonical.items = canonical.items.map((item, index) => ({
    ...item,
    challenge: getChallenge(listChallenges()[index].id),
  }));
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (init?.method !== "POST") return Response.json(canonical);
    const request = JSON.parse(String(init.body));
    if (path.endsWith("/answer")) {
      const item = canonical.items[canonical.currentIndex!];
      item.answer = {
        id: `44444444-4444-4444-8444-44444444444${item.position}`,
        answeredAt: viewer.createdAt,
        result: submitAnswer(item.challenge.id, { optionId: request.optionId }),
      };
      canonical = {
        ...canonical,
        phase: "review",
        revision: canonical.revision + 1,
      };
    } else if (path.endsWith("/advance")) {
      canonical =
        canonical.currentIndex === canonical.items.length - 1
          ? {
              ...canonical,
              status: "completed",
              phase: "completed",
              currentIndex: null,
              completedAt: viewer.createdAt,
              revision: canonical.revision + 1,
            }
          : {
              ...canonical,
              phase: "setup",
              currentIndex: canonical.currentIndex! + 1,
              revision: canonical.revision + 1,
            };
    } else
      return Response.json({
        session: { ...snapshot(), id: "55555555-5555-4555-8555-555555555555" },
        replayed: false,
        created: true,
      });
    return Response.json({ session: canonical, replayed: false });
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  const view = render(
    <ChallengePlayer
      initialSession={structuredClone(canonical)}
      viewer={viewer}
    />,
  );
  const catalogue = listChallenges();
  // Different-but-defensible, same-but-risky, then a defensible match.
  const choices = ["cover-contact", "contest-short", "clear-forward"];

  for (const [index, summary] of catalogue.entries()) {
    const challenge = getChallenge(summary.id);
    const setup = challenge.setup;
    if (setup.kind !== "youtube")
      throw new Error("Expected approved VOD content");
    await screen.findByRole("heading", { level: 1, name: challenge.title });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Play setup" })).toBeEnabled(),
    );
    const instance = provider.instances[index];
    expect(provider.instances).toHaveLength(index + 1);
    expect(
      screen.queryByRole("region", { name: "Answer feedback" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(instance.bounds.endSeconds).toBe(setup.endSeconds);
    expect(screen.getByRole("link", { name: /Source: TenZ/ })).toHaveAttribute(
      "href",
      challenge.source!.url,
    );
    await user.click(screen.getByRole("button", { name: "Play setup" }));
    await act(async () => {
      instance.time = setup.endSeconds - 0.25;
      instance.events.onStateChange({ target: instance.player, data: 1 });
    });
    await screen.findByRole("heading", { name: challenge.question });
    expect(
      screen.getByRole("heading", { name: challenge.question }),
    ).toHaveFocus();
    expect(instance.player.destroy).not.toHaveBeenCalled();
    const option = challenge.options.find(
      (entry) => entry.id === choices[index],
    )!;
    await user.click(screen.getByRole("radio", { name: option.label }));

    if (index === 0) {
      await user.click(screen.getByRole("button", { name: /Replay setup/ }));
      expect(instance.bounds.startSeconds).toBe(setup.startSeconds);
      await act(async () => {
        instance.time = setup.endSeconds - 0.25;
        instance.events.onStateChange({ target: instance.player, data: 1 });
      });
      expect(screen.getByRole("radio", { name: option.label })).toBeChecked();
      expect(provider.instances).toHaveLength(1);
    }

    await user.click(screen.getByRole("button", { name: /Lock in your call/ }));
    const feedback = await screen.findByRole("region", {
      name: "Answer feedback",
    });
    await waitFor(() =>
      expect(instance.bounds.startSeconds).toBe(setup.endSeconds),
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      within(feedback).getByRole("heading", {
        name:
          index === 0
            ? "Different choice from the pro"
            : "Same choice as the pro",
      }),
    ).toBeVisible();
    expect(
      feedback.querySelector(".section-heading .assessment"),
    ).toHaveTextContent(index === 1 ? "Risky" : "Defensible");
    expect(
      within(feedback).getByRole("region", { name: "AI analysis" }),
    ).toBeVisible();
    const video = screen.getByRole("region", { name: "Pro continuation" });
    expect(
      video.compareDocumentPosition(feedback) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Setup" }));
    expect(instance.bounds.endSeconds).toBe(setup.endSeconds);
    await user.click(screen.getByRole("button", { name: "Outcome" }));
    expect(instance.bounds.startSeconds).toBe(setup.endSeconds);
    expect(provider.instances).toHaveLength(index + 1);
    await user.click(
      screen.getByRole("button", {
        name: index === 2 ? /Finish session/ : /Next scenario/,
      }),
    );
    expect(instance.player.destroy).toHaveBeenCalledOnce();
  }

  await screen.findByRole("heading", { level: 1, name: /Three calls/ });
  expect(document.querySelectorAll("details.recap-card")).toHaveLength(3);
  const firstRecap = screen.getByText(catalogue[0].title).closest("details")!;
  await user.click(within(firstRecap).getByText(catalogue[0].title));
  expect(
    within(firstRecap).getByText("AI ANALYSIS · INTERPRETATION"),
  ).toBeVisible();
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(6);
  await user.click(screen.getByRole("button", { name: /Play again/ }));
  expect(router.push).toHaveBeenCalledWith(
    "/play/55555555-5555-4555-8555-555555555555",
  );
  // Reloading the original completed session preserves its historical recap.
  view.unmount();
  render(
    <ChallengePlayer
      initialSession={structuredClone(canonical)}
      viewer={viewer}
    />,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: /Three calls/ }),
  ).toBeVisible();
  expect(document.querySelectorAll("details.recap-card")).toHaveLength(3);
});
