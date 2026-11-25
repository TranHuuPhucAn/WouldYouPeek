import { normalizeDraftContent } from "./content";
import type {
  CreatorDraftContent,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";

export type DraftSaveCommand = {
  requestId: string;
  expectedRevision: number;
  // Keep the raw submitted text to distinguish later typing from normalization.
  // The transport normalizes a copy, including on retries of this command.
  content: CreatorDraftContent;
};
export type EditorState = {
  snapshot: CreatorScenarioSnapshot;
  content: CreatorDraftContent;
  pending: boolean;
  command: DraftSaveCommand | null;
  error: string | null;
  conflict: boolean;
  latest: CreatorScenarioSnapshot | null;
  invalid: boolean;
  resetKey: number;
};
export function createEditorState(
  snapshot: CreatorScenarioSnapshot,
): EditorState {
  return {
    snapshot,
    content: structuredClone(snapshot.draft.content),
    pending: false,
    command: null,
    error: null,
    conflict: false,
    latest: null,
    invalid: false,
    resetKey: 0,
  };
}
export function isEditorDirty(state: EditorState) {
  if (state.invalid) return false;
  return !sameDraftValue(
    normalizeDraftContent(state.content),
    normalizeDraftContent(state.snapshot.draft.content),
  );
}
// JSONB can reorder object keys; choice/list order and raw text still matter.
function sameDraftValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left))
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameDraftValue(value, right[index]))
    );
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(right)
  )
    return false;
  const leftObject = left as Record<string, unknown>,
    rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject);
  return (
    keys.length === Object.keys(rightObject).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightObject, key) &&
        sameDraftValue(leftObject[key], rightObject[key]),
    )
  );
}
export function buildDraftCommand(
  state: EditorState,
  requestId: string,
): DraftSaveCommand {
  return {
    requestId,
    expectedRevision: state.snapshot.revision,
    content: structuredClone(state.content),
  };
}
type Action =
  | { type: "EDIT"; content: CreatorDraftContent }
  | { type: "START"; command: DraftSaveCommand }
  | {
      type: "SAVED";
      snapshot: CreatorScenarioSnapshot;
      submitted: CreatorDraftContent;
    }
  | {
      type: "FAILED";
      message: string;
      conflict?: boolean;
      retainCommand?: boolean;
    }
  | { type: "LATEST"; snapshot: CreatorScenarioSnapshot }
  | { type: "ACCEPT_LATEST" }
  | { type: "INVALIDATE" };
export function editorReducer(state: EditorState, action: Action): EditorState {
  if (state.invalid) return state;
  switch (action.type) {
    case "EDIT":
      return { ...state, content: action.content };
    case "START":
      return { ...state, pending: true, command: action.command, error: null };
    case "SAVED": {
      if (
        action.snapshot.id !== state.snapshot.id ||
        action.snapshot.revision < state.snapshot.revision
      )
        return {
          ...state,
          pending: false,
          error:
            "This saved response is out of date. Compare with the latest draft.",
          conflict: true,
          command: null,
        };
      // Replays return current canonical state, which may include another tab's
      // later edit. Never rebase our older full form onto that newer revision.
      if (
        !sameDraftValue(
          normalizeDraftContent(action.snapshot.draft.content),
          normalizeDraftContent(action.submitted),
        )
      )
        return {
          ...state,
          pending: false,
          command: null,
          conflict: true,
          latest: action.snapshot,
          error:
            "The server confirmed the save, but the saved draft has since changed. Your local text is still here. Compare with the latest draft before continuing.",
        };
      const editedDuringSave = !sameDraftValue(state.content, action.submitted);
      return {
        ...state,
        snapshot: action.snapshot,
        content: editedDuringSave
          ? state.content
          : structuredClone(action.snapshot.draft.content),
        command: null,
        pending: false,
        error: null,
        conflict: false,
        latest: null,
      };
    }
    case "FAILED":
      return {
        ...state,
        pending: false,
        command: action.retainCommand ? state.command : null,
        error: action.message,
        conflict: !!action.conflict,
      };
    case "LATEST":
      return action.snapshot.id === state.snapshot.id &&
        action.snapshot.revision >= state.snapshot.revision
        ? { ...state, latest: action.snapshot }
        : state;
    case "ACCEPT_LATEST":
      return state.latest
        ? { ...createEditorState(state.latest), resetKey: state.resetKey + 1 }
        : state;
    case "INVALIDATE":
      return {
        ...state,
        content: {} as CreatorDraftContent,
        latest: null,
        command: null,
        pending: false,
        invalid: true,
      };
  }
}
