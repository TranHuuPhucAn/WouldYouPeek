import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DemoPreview } from "@/components/demo/DemoPreview";
import { challenges } from "./fixtures";
const teardown = vi.fn();
vi.mock("@/components/challenge/ScenarioMedia", async () => {
  const React = await import("react");
  return {
    ScenarioMedia: ({ media }: { media: { alt: string } }) => {
      React.useEffect(() => () => teardown(), []);
      return <div>{media.alt}</div>;
    },
  };
});
it("switches setup-only previews and unmounts old media without offering answers", async () => {
  const previews = challenges.map(
    ({ id, title, topic, order, mediaStatus, context, setup }) => ({
      id,
      title,
      topic,
      order,
      mediaStatus,
      context,
      setup,
    }),
  );
  const user = userEvent.setup();
  render(<DemoPreview previews={previews} />);
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByText("Here’s the reasoning.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Missed shot/ }));
  expect(teardown).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("heading", { name: "Missed shot. New angle." }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: /Sign in to play/ })).toHaveAttribute(
    "href",
    "/sign-in?returnTo=%2Fplay",
  );
});
