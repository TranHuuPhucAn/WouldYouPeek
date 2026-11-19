import { describe, expect, it } from "vitest";
import {
  parseTimestampInput,
  formatTimestampInput,
  getTimingSummary,
} from "@/lib/creator/timestamps";
import {
  createEditorState,
  editorReducer,
  buildDraftCommand,
  isEditorDirty,
} from "@/lib/creator/editor-state";
import {
  createPreviewState,
  previewReducer,
  selectPreviewFeedback,
} from "@/lib/creator/preview-state";
import { creatorSnapshot, creatorPreview, commandId } from "./creator-fixtures";
describe("creator timestamps", () => {
  it.each([
    ["", null],
    ["12", 12],
    ["12.125", 12.125],
    ["01:02", 62],
    ["1:02:03.125", 3723.125],
    ["12:00:00", 43200],
  ])("parses %s exactly", (input, value) =>
    expect(parseTimestampInput(input)).toEqual({ value, error: null }),
  );
  it.each([
    "-1",
    "1e3",
    "Infinity",
    "0:60",
    "1:60:00",
    "12:00:01",
    "1.1234",
    "1::2",
    "0.1:02",
    "nope",
  ])("rejects malformed or out-of-range %s", (input) =>
    expect(parseTimestampInput(input).error).toBeTruthy(),
  );
  it("formats fractional values without losing precision", () => {
    expect(formatTimestampInput(62.125)).toBe("1:02.125");
    expect(formatTimestampInput(null)).toBe("");
    expect(getTimingSummary(creatorSnapshot().draft.content.media)).toEqual({
      setup: 8,
      continuation: 5,
    });
  });
});
describe("explicit save state", () => {
  it("copies drafts and freezes the submitted command independently", () => {
    const snapshot = creatorSnapshot();
    let state = createEditorState(snapshot);
    state = editorReducer(state, {
      type: "EDIT",
      content: { ...state.content, title: "First" },
    });
    const command = buildDraftCommand(state, commandId);
    state.content.title = "Later";
    expect(command.content.title).toBe("First");
    expect(snapshot.draft.content.title).not.toBe("First");
  });
  it("preserves edits made while an earlier save was in flight", () => {
    let state = createEditorState(creatorSnapshot());
    const submitted = { ...state.content, title: "First" };
    state = editorReducer(state, { type: "EDIT", content: submitted });
    const saved = structuredClone(state.snapshot);
    saved.revision++;
    saved.draft = { ...saved.draft, revision: 2, content: submitted };
    state = editorReducer(state, {
      type: "EDIT",
      content: { ...submitted, title: "Later" },
    });
    state = editorReducer(state, { type: "SAVED", snapshot: saved, submitted });
    expect(state.content.title).toBe("Later");
    expect(state.snapshot.draft.content.title).toBe("First");
    expect(isEditorDirty(state)).toBe(true);
  });
  it("treats normalization as a no-op and retains an existing review", () => {
    let state = createEditorState(creatorSnapshot(true, true));
    state = editorReducer(state, {
      type: "EDIT",
      content: { ...state.content, title: `  ${state.content.title}  ` },
    });
    expect(isEditorDirty(state)).toBe(false);
    state = editorReducer(state, {
      type: "SAVED",
      snapshot: state.snapshot,
      submitted: state.content,
    });
    expect(state.snapshot.review).not.toBeNull();
    expect(isEditorDirty(state)).toBe(false);
  });
  it("requires an explicit accept before replacing conflicted local text", () => {
    let state = createEditorState(creatorSnapshot());
    state = editorReducer(state, {
      type: "EDIT",
      content: { ...state.content, title: "My local text" },
    });
    state = editorReducer(state, {
      type: "FAILED",
      message: "Conflict",
      conflict: true,
    });
    const latest = creatorSnapshot();
    latest.revision = 3;
    latest.draft.revision = 2;
    latest.draft.content.title = "Other tab";
    state = editorReducer(state, { type: "LATEST", snapshot: latest });
    expect(state.content.title).toBe("My local text");
    state = editorReducer(state, { type: "ACCEPT_LATEST" });
    expect(state.content.title).toBe("Other tab");
    expect(state.resetKey).toBe(1);
    expect(state.conflict).toBe(false);
  });
  it("does not install regressed or wrong scenario responses", () => {
    const state = createEditorState(creatorSnapshot());
    for (const next of [
      { ...state.snapshot, revision: 0 },
      { ...state.snapshot, id: commandId },
    ])
      expect(
        editorReducer(state, {
          type: "SAVED",
          snapshot: next,
          submitted: state.content,
        }).conflict,
      ).toBe(true);
  });
  it("erases local fields and ignores late results on identity invalidation", () => {
    const before = createEditorState(creatorSnapshot());
    const state = editorReducer(before, { type: "INVALIDATE" });
    expect(state.content).toEqual({});
    expect(isEditorDirty(state)).toBe(false);
    expect(
      editorReducer(state, {
        type: "SAVED",
        snapshot: before.snapshot,
        submitted: before.content,
      }),
    ).toBe(state);
  });
});
describe("isolated preview progression", () => {
  it("requires setup and a choice before exposing feedback, and safely resets", () => {
    let state = createPreviewState();
    expect(previewReducer(state, { type: "SUBMIT" })).toBe(state);
    state = previewReducer(state, { type: "SETUP_COMPLETE" });
    expect(previewReducer(state, { type: "SUBMIT" })).toBe(state);
    state = previewReducer(state, { type: "SELECT", optionId: "test" });
    state = previewReducer(state, { type: "SUBMIT" });
    expect(state.phase).toBe("review");
    expect(state.reviewMedia).toBe("outcome");
    state = previewReducer(state, { type: "MEDIA", media: "setup" });
    expect(state.reviewMedia).toBe("setup");
    state = previewReducer(state, { type: "RESET" });
    expect(state).toEqual({ ...createPreviewState(), attempt: 1 });
  });
  it("only exposes feedback for a real option", () => {
    const preview = creatorPreview();
    expect(selectPreviewFeedback(preview, "missing")).toBeNull();
    expect(
      selectPreviewFeedback(preview, preview.challenge.options[1].id)
        ?.matchesPro,
    ).toBe(false);
  });
});

describe("save confirmation and raw text reconciliation", () => {
  it("keeps a trailing space and an unfinished list line typed during a save", () => {
    const original = createEditorState(creatorSnapshot());
    const submitted = structuredClone(original.content);
    let state = editorReducer(original, {
      type: "EDIT",
      content: {
        ...submitted,
        title: `${submitted.title} `,
        knownFacts: [...submitted.knownFacts, ""],
      },
    });
    state = editorReducer(state, {
      type: "SAVED",
      snapshot: original.snapshot,
      submitted,
    });
    expect(state.content.title).toBe(`${submitted.title} `);
    expect(state.content.knownFacts).toEqual([...submitted.knownFacts, ""]);
    expect(state.conflict).toBe(false);
    expect(isEditorDirty(state)).toBe(false);
  });

  it("accepts reordered JSON object keys without confusing them with content edits", () => {
    const original = createEditorState(creatorSnapshot());
    function reorder(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, nested]) => [key, reorder(nested)]),
        );
      return value;
    }
    const saved = structuredClone(original.snapshot);
    saved.draft.content = reorder(
      saved.draft.content,
    ) as typeof saved.draft.content;
    const state = editorReducer(original, {
      type: "SAVED",
      snapshot: saved,
      submitted: original.content,
    });
    expect(state.conflict).toBe(false);
    expect(state.latest).toBeNull();
    expect(isEditorDirty({ ...state, content: original.content })).toBe(false);
  });

  it("does not treat a changed choice order as mere JSON object ordering", () => {
    const original = createEditorState(creatorSnapshot());
    const newer = structuredClone(original.snapshot);
    newer.revision += 2;
    newer.draft.revision += 1;
    newer.draft.content.options.reverse();
    const state = editorReducer(original, {
      type: "SAVED",
      snapshot: newer,
      submitted: original.content,
    });
    expect(state.conflict).toBe(true);
    expect(state.snapshot.revision).toBe(original.snapshot.revision);
    expect(state.latest).toEqual(newer);
  });
});
