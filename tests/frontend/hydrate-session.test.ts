import { expect, it } from "vitest";
import { hydrateSessionSnapshot } from "@/lib/session/hydrate-session";
import { snapshot, viewer } from "./session-fixtures";
it.each(["setup", "review", "completed"] as const)(
  "hydrates %s from durable checkpoint",
  (phase) => {
    const result = hydrateSessionSnapshot(snapshot(phase), viewer.id);
    expect(result.phase).toBe(phase === "completed" ? "complete" : phase);
    expect(result.completed).toHaveLength(
      phase === "setup" ? 0 : phase === "review" ? 1 : 3,
    );
  },
);
it("restores last review rather than completing without Finish", () => {
  const result = hydrateSessionSnapshot(snapshot("review", 2), viewer.id);
  expect(result.phase).toBe("review");
  expect(result.feedback).toBeTruthy();
  expect(result.currentIndex).toBe(2);
});
