import { describe, it, expect } from "vitest";
import { hydrateSessionSnapshot } from "@/lib/session/hydrate-session";
import {
  createInitialSessionState,
  sessionReducer,
} from "@/lib/session/session-reducer";
import {
  parseSessionSnapshot,
  validateSessionContinuity,
} from "@/lib/client/session-api";
import { playlistSession } from "./playlist-fixtures";
import { snapshot, viewer } from "./session-fixtures";
import type { SessionSnapshot } from "@/contracts/session";
function saved(count: number, phase: SessionSnapshot["phase"], index = 0) {
  const value = playlistSession(),
    original = snapshot("completed").items[0];
  value.items = Array.from({ length: count }, (_, position) => {
    const challengeId = `20000000-0000-4000-8000-${String(position).padStart(12, "0")}`;
    return {
      id: `30000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
      position,
      challenge: {
        ...original.challenge,
        id: challengeId,
        order: position + 1,
      },
      answer:
        phase === "completed" ||
        position < index ||
        (phase === "review" && position === index)
          ? {
              ...original.answer!,
              id: `40000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
              result: { ...original.answer!.result, challengeId },
            }
          : null,
    };
  });
  value.playlist!.players = value.playlist!.players.slice(0, count);
  value.phase = phase;
  value.status = phase === "completed" ? "completed" : "in_progress";
  value.currentIndex = phase === "completed" ? null : index;
  value.completedAt = phase === "completed" ? value.updatedAt : null;
  value.revision =
    phase === "completed"
      ? count * 2
      : index * 2 + (phase === "review" ? 1 : 0);
  return value;
}
describe("playlist saved checkpoints for one to twenty decisions", () => {
  it.each([1, 20])(
    "restores each setup/review checkpoint for %i items and requires saved finish",
    (count) => {
      let state = createInitialSessionState({
        snapshot: parseSessionSnapshot(saved(count, "setup")),
        viewerId: viewer.id,
      });
      for (let index = 0; index < count; index++) {
        const setup = parsed("setup", index);
        state = sessionReducer(state, {
          type: "HYDRATE",
          snapshot: setup,
          viewerId: viewer.id,
        });
        expect(state.currentIndex).toBe(index);
        expect(state.phase).toBe("setup");
        state = sessionReducer(state, { type: "SETUP_FINISHED" });
        state = sessionReducer(state, {
          type: "SELECT_OPTION",
          optionId: "hold",
        });
        expect(state.feedback).toBeNull();
        state = sessionReducer(state, { type: "COMMAND_STARTED" });
        expect(state.snapshot.items[index].answer).toBeNull();
        const review = parsed("review", index);
        validateSessionContinuity(review, state.snapshot);
        state = sessionReducer(state, {
          type: "HYDRATE",
          snapshot: review,
          viewerId: viewer.id,
        });
        const reload = hydrateSessionSnapshot(review, viewer.id);
        expect(reload.completed).toHaveLength(index + 1);
        expect(reload.phase).toBe("review");
        expect(reload.feedback).toEqual(review.items[index].answer!.result);
      }
      expect(state.phase).toBe("review");
      const completed = parsed("completed");
      state = sessionReducer(state, {
        type: "HYDRATE",
        snapshot: completed,
        viewerId: viewer.id,
      });
      expect(state.phase).toBe("complete");
      expect(state.completed).toHaveLength(count);
      expect(state.snapshot.playlist).toEqual(completed.playlist);
      function parsed(phase: SessionSnapshot["phase"], index = 0) {
        return parseSessionSnapshot(saved(count, phase, index));
      }
    },
  );
});
